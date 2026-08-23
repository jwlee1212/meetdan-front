// 파일: api/client.ts
// Supabase 연동 레이어. 화면은 supabase-js 를 직접 부르지 않고 전부 여기를 거친다.
//
// 반환 형태는 기존 mock 과 같은 { code, message?, data? } 봉투를 유지했다.
// 화면 쪽 분기(`result.code === 200`)를 그대로 쓸 수 있고,
// Supabase 의 날것 에러 메시지가 사용자에게 새어 나가지 않는다.

import {
  clearRegisteredPushToken,
  getRegisteredPushToken,
} from "@/lib/push";
import { supabase } from "@/lib/supabase";
import type {
  AppNotification,
  BlockedUser,
  ConfirmedPlan,
  CurrentUser,
  Match,
  MatchRequest,
  NotificationKind,
  ReportReason,
  ReportTargetType,
  Team,
  TeamMember,
} from "@/store/useStore";
import type { PostgrestError } from "@supabase/supabase-js";

export type ApiResponse<T = any> = {
  code: number;
  message?: string;
  data?: T;
};

const ok = <T,>(data?: T, message?: string): ApiResponse<T> => ({
  code: 200,
  data,
  message,
});

const fail = (code: number, message: string): ApiResponse<never> => ({
  code,
  message,
});

// ============================================================
// profiles ↔ CurrentUser 매핑
// ============================================================

/** 화면이 필요로 하는 컬럼만. 운영용 컬럼(strike_count 등)은 가져오지 않는다. */
const PROFILE_COLUMNS =
  "id, login_id, name, email, gender, campus, dept, birth_year, nickname, bio, mbti, avatar_idx, status, email_verified_at, deleted_at";

type ProfileRow = {
  id: string;
  login_id: string;
  name: string;
  email: string;
  gender: "M" | "F";
  campus: "죽전" | "천안";
  dept: string;
  /** 마이그레이션 006 이전에 가입한 계정은 비어 있다. */
  birth_year: number | null;
  nickname: string | null;
  bio: string | null;
  mbti: string | null;
  avatar_idx: number;
  status: "active" | "warned" | "suspended" | "deleted";
  email_verified_at: string | null;
  deleted_at: string | null;
};

/**
 * 세는나이. 서버의 korean_age() 와 같은 식이다.
 * 팀 평균은 서버가 내지만, 내 나이 한 줄을 보여주는 데 왕복할 필요는 없다.
 */
export const koreanAge = (birthYear: number): number =>
  new Date().getFullYear() - birthYear + 1;

const toCurrentUser = (row: ProfileRow): CurrentUser => {
  const nickname = row.nickname?.trim() ?? "";
  return {
    id: row.id,
    loginId: row.login_id,
    name: row.name,
    email: row.email,
    // 별명은 비워둘 수 있다. 화면에 이름을 뿌릴 땐 displayName 을 쓴다.
    nickname,
    displayName: nickname || row.name,
    dept: row.dept,
    gender: row.gender,
    campus: row.campus,
    birthYear: row.birth_year,
    age: row.birth_year === null ? null : koreanAge(row.birth_year),
    bio: row.bio ?? "",
    mbti: row.mbti ?? "",
    avatarIdx: row.avatar_idx,
  };
};

// ============================================================
// 에러 번역 — DB 제약/인증 에러를 사람이 읽을 문구로
// ============================================================

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * PGRST303 "JWT issued at future".
 *
 * 이 프로젝트는 비대칭 서명 키(ES256)를 쓰는데, GoTrue 가 방금 발급한 토큰의
 * iat 가 살짝 뒤처진 PostgREST 쪽 시계에서는 미래로 보일 때가 있다.
 * 가입/로그인 직후 첫 쿼리에서만 나타나고 1~2초면 저절로 풀린다.
 * 기기 시계와는 무관하다(검증은 전부 서버에서 한다).
 */
const isClockSkewError = (error: PostgrestError | null) =>
  error?.code === "PGRST303";

/**
 * PGRST303 만 잠깐 쉬었다 다시 물어본다.
 * 로그인 직후 처음 열리는 화면(홈 피드)이 이 경합에 가장 잘 걸린다.
 * 쿼리를 매번 새로 만들어야 해서 결과가 아니라 '만드는 함수'를 받는다.
 */
const retryOnClockSkew = async <T>(
  run: () => PromiseLike<{ data: T | null; error: PostgrestError | null }>,
): Promise<{ data: T | null; error: PostgrestError | null }> => {
  let result = await run();
  for (let attempt = 0; attempt < 2 && isClockSkewError(result.error); attempt++) {
    await sleep(1200);
    result = await run();
  }
  return result;
};

const describeDbError = (error: PostgrestError): string => {
  if (isClockSkewError(error)) {
    return "서버와 시간이 어긋났어요. 잠시 후 다시 시도해주세요.";
  }
  // 23505: unique_violation
  if (error.code === "23505") {
    if (error.message.includes("login_id")) return "이미 사용 중인 아이디예요.";
    if (error.message.includes("email")) return "이미 가입된 이메일이에요.";
    return "이미 등록된 정보예요.";
  }
  // 23514: check_violation — 스키마의 길이/형식 제약에 걸린 경우
  if (error.code === "23514") {
    if (error.message.includes("email")) {
      return "단국대 이메일(@dankook.ac.kr)만 사용할 수 있어요.";
    }
    if (error.message.includes("mbti")) return "MBTI 형식이 올바르지 않아요.";
    return "입력값이 형식에 맞지 않아요.";
  }
  // 42501: RLS 위반
  if (error.code === "42501") return "권한이 없어요. 다시 로그인해주세요.";

  console.error("[DB 오류]", error);
  return "서버 처리 중 문제가 발생했어요.";
};

/**
 * 팀 쪽 트리거·RPC 는 raise exception 으로 이미 사람이 읽을 한국어를 올린다
 * (join_team_by_code, assert_team_not_full, assert_team_full_before_publish …).
 * 그대로 보여주되, 목록에 없는 오류까지 날것으로 새어 나가지 않게 한 번 거른다.
 */
const TEAM_ERROR_MESSAGES = [
  "초대 코드를 찾을 수 없습니다",
  "이미 참여한 팀입니다",
  "팀 정원이 가득 찼습니다",
  "같은 성별끼리만 팀을 이룰 수 있습니다",
  "프로필이 없어 팀에 참여할 수 없습니다",
  "이미 매칭이 성사된 팀입니다",
  "팀원이 다 모여야 게시판에 공개할 수 있습니다",
  "이용이 제한된 계정입니다",
  "프로필이 없어 팀을 만들 수 없습니다",
  "초대 코드를 발급하지 못했습니다",
];

const describeTeamError = (error: { message: string; code?: string }): string => {
  const known = TEAM_ERROR_MESSAGES.find((m) => error.message.includes(m));
  if (known) return known;

  // filled_count <= capacity. '인원을 이미 모인 수보다 적게' 줄이려 한 경우다.
  if (error.code === "23514" && error.message.includes("filled_count")) {
    return "이미 모인 팀원 수보다 적게 줄일 수 없어요.";
  }
  // teams_tags_bounded — 화면이 이미 막지만, 구버전 앱이 넘어올 수 있다.
  if (error.code === "23514" && error.message.includes("tags")) {
    return "태그는 최대 3개, 하나당 12자까지예요.";
  }
  /*
   * 42501 = RLS 위반. 팀 쪽에서는 세션이 아니라 정책에 막힌 것이라
   * describeDbError 의 "다시 로그인해주세요" 가 사람을 엉뚱한 데로 보낸다.
   * 원인은 둘 중 하나이고 서버가 주는 문구는 똑같아서 여기서는 못 가른다.
   *   · teams_select 에 owner_id 가 없다   → 마이그레이션 008
   *   · is_account_active() 가 false       → profiles.email_verified_at 확인
   * 날것 메시지를 콘솔에 남겨 두 갈래를 개발자가 바로 볼 수 있게 한다.
   */
  if (error.code === "42501") {
    console.error("[팀 RLS 거부]", error.message);
    return "서버 정책에 막혔어요. 계정 인증 상태를 확인해주세요.";
  }

  return describeDbError(error as PostgrestError);
};

/**
 * 매칭 신청·수락·거절에서 서버가 올리는 문구.
 * 마이그레이션 009 의 assert_match_request_valid / on_match_accepted 가 던진다.
 */
const MATCH_ERROR_MESSAGES = [
  "이성 팀에만 신청할 수 있습니다",
  "인원 수가 같은 팀에만 신청할 수 있습니다",
  "게시판에 공개된 팀에만 신청할 수 있습니다",
  "우리 팀 인원이 다 모여야 신청할 수 있습니다",
  "양쪽 팀원이 다 모여야 매칭할 수 있습니다",
  "이미 매칭이 성사된 팀입니다",
  "이미 응답한 신청입니다",
  "신청을 받은 팀의 팀장만 수락할 수 있습니다",
  "이 신청을 처리할 권한이 없습니다",
  "신청할 팀을 찾을 수 없습니다",
  "상대 팀을 찾을 수 없습니다",
  "신청 대상은 바꿀 수 없습니다",
  // set_match_plan RPC
  "매칭을 찾을 수 없습니다",
  "이 매칭의 참여자가 아닙니다",
  "성사된 매칭에만 약속을 정할 수 있습니다",
];

const describeMatchError = (error: { message: string; code?: string }): string => {
  const known = MATCH_ERROR_MESSAGES.find((m) => error.message.includes(m));
  if (known) return known;

  // 같은 팀에 대기중 신청은 하나뿐이다 (matches_no_duplicate_waiting 부분 인덱스)
  if (
    error.code === "23505" &&
    error.message.includes("matches_no_duplicate_waiting")
  ) {
    return "이미 신청한 팀이에요. 상대방의 응답을 기다려주세요.";
  }
  /*
   * 40P01(deadlock) / 40001(serialization).
   * 겹치는 두 팀에서 동시에 수락을 누르면 나올 수 있다. 어차피 한쪽은
   * 실패해야 하는 상황이라, 날것의 영어 대신 다시 눌러보라고 안내한다.
   */
  if (error.code === "40P01" || error.code === "40001") {
    return "지금 다른 매칭이 함께 진행 중이에요. 잠시 후 다시 시도해주세요.";
  }
  // matches_insert 정책은 '보내는 팀의 팀장'만 통과시킨다.
  // 팀 쪽 42501 과 원인이 달라서 여기서 먼저 가른다.
  if (error.code === "42501") {
    console.error("[매칭 RLS 거부]", error.message);
    return "팀장만 매칭을 신청할 수 있어요.";
  }

  return describeTeamError(error);
};

const describeAuthError = (message: string): string => {
  if (message.includes("already registered")) return "이미 가입된 이메일이에요.";
  if (message.includes("Password should be")) {
    return "비밀번호는 6자 이상이어야 해요.";
  }
  // auth.users 트리거(handle_new_user)가 실패하면 signUp 이 통째로 롤백되고
  // GoTrue 는 원인을 숨긴 이 문구만 돌려준다. 원인은 Postgres 로그에 있다.
  if (
    message.includes("Database error saving new user") ||
    message.includes("unexpected_failure")
  ) {
    if (message.includes("login_id")) return "이미 사용 중인 아이디예요.";
    return "가입 정보를 저장하지 못했어요. 잠시 후 다시 시도해주세요.";
  }
  if (message.includes("duplicate key")) {
    if (message.includes("login_id")) return "이미 사용 중인 아이디예요.";
    return "이미 가입된 정보예요.";
  }
  if (message.includes("Invalid login credentials")) {
    return "아이디 또는 비밀번호가 올바르지 않습니다.";
  }
  if (message.includes("Email rate limit") || message.includes("rate limit")) {
    return "요청이 너무 잦아요. 잠시 후 다시 시도해주세요.";
  }
  console.error("[인증 오류]", message);
  return "인증 처리 중 문제가 발생했어요.";
};

/**
 * Edge Function 호출 결과를 한 곳에서 해석한다.
 * supabase-js 는 2xx 가 아닐 때만 error 를 채우므로,
 * 200 으로 { error: "..." } 를 돌려주는 함수까지 함께 본다.
 */
const readFunctionResult = <T extends Record<string, any>>(
  data: T | null,
  error: unknown,
  /**
   * 실패가 정상 흐름인 호출에서 켠다.
   * 예: resolve-login 은 없는 아이디에 401 을 준다 = "그 아이디 비어 있음".
   * 이걸 매번 error 로 찍으면 진짜 오류가 로그에 묻힌다.
   */
  options?: { quiet?: boolean },
): { ok: true; data: T } | { ok: false; message: string | null } => {
  if (error) {
    if (!options?.quiet) console.error("[Edge Function 오류]", error);
    return { ok: false, message: null };
  }
  if (data && typeof data.error === "string") {
    return { ok: false, message: data.error };
  }
  if (!data) return { ok: false, message: null };
  return { ok: true, data };
};

// ============================================================
// 이메일 인증 (verify-email Edge Function)
// ============================================================

// ⚠️ verify-email 의 요청/응답 형태를 여기 한 곳에만 뒀다.
//    실제 함수 시그니처가 다르면 아래 두 함수의 body 만 고치면 된다.
//      발송: { email, action: "send" }
//      확인: { email, code, action: "verify" }
const VERIFY_EMAIL_FN = "verify-email";

/**
 * 🚧 개발용 이메일 인증 우회.
 *
 * verify-email 함수가 아직 `401 invalid signature` 를 돌려주고 있어서,
 * 그동안 나머지 백엔드 연동(가입 → 프로필 생성 → 로그인 → 세션 복원)을
 * 막지 않으려고 둔 임시 통로다.
 *
 * `__DEV__` 를 함께 보는 게 핵심이다. 릴리스 빌드에서는 `__DEV__` 가 false 라
 * .env 에 플래그가 남아 있어도 절대 켜지지 않는다.
 * verify-email 이 고쳐지면 이 상수와 아래 두 곳의 분기만 지우면 된다.
 */
const SKIP_EMAIL_VERIFY =
  __DEV__ && process.env.EXPO_PUBLIC_SKIP_EMAIL_VERIFY === "true";

if (SKIP_EMAIL_VERIFY) {
  console.warn(
    "🚧 [개발 모드] 이메일 인증을 건너뜁니다. " +
      "EXPO_PUBLIC_SKIP_EMAIL_VERIFY 를 지우면 실제 인증으로 돌아갑니다.",
  );
}

// ============================================================
// 회원가입 / 로그인
// ============================================================

/** 회원가입 최종 제출. 비밀번호는 Supabase Auth 로만 가고 기기에 남지 않는다. */
export type SignupRequest = {
  name: string;
  gender: "M" | "F";
  /** 출생연도. 팀 평균 나이(teams.avg_age)를 서버가 계산하는 유일한 근거다. */
  birthYear: number;
  campus: "죽전" | "천안";
  dept: string;
  email: string;
  userId: string;
  password: string;
};

/** 마이 탭에서 바꿀 수 있는 값들. 이름·성별·캠퍼스·학과는 가입 시 확정이라 제외. */
export type ProfilePatch = {
  nickname: string;
  bio: string;
  mbti: string;
  avatarIdx: number;
};

// ============================================================
// teams / team_members ↔ Team 매핑
// ============================================================

/**
 * 팀 하나를 그리는 데 필요한 컬럼.
 *
 * filled_count / status / invite_code 는 클라이언트가 계산하지 않는다.
 *   · filled_count, status — team_members_sync_fill 트리거가 관리
 *   · invite_code          — teams_set_invite_code 트리거가 발급
 *   · dept, gender         — teams_set_owner_facts 트리거가 프로필에서 복사
 *   · avg_age              — team_members_sync_avg_age 트리거가 팀원
 *                            profiles.birth_year 로 다시 계산 (마이그레이션 006)
 */
const TEAM_COLUMNS =
  "id, owner_id, title, content, campus, dept, gender, avg_age, tags, capacity, filled_count, status, invite_code, created_at";

/** 팀원 카드가 그리는 값. team_members → profiles 조인. */
const TEAM_SELECT = `${TEAM_COLUMNS}, team_members(is_owner, profiles(name, nickname, dept, mbti, bio, avatar_idx))`;

type TeamMemberRow = {
  is_owner: boolean;
  /** 차단한 상대는 profiles_select 가 가려서 null 로 온다. */
  profiles: {
    name: string;
    nickname: string | null;
    dept: string;
    mbti: string | null;
    bio: string | null;
    avatar_idx: number;
  } | null;
};

type TeamRow = {
  id: string;
  owner_id: string;
  title: string;
  content: string;
  campus: "죽전" | "천안";
  dept: string;
  gender: "M" | "F";
  /** 팀원 중 출생연도를 등록한 사람이 없으면 null 이다. */
  avg_age: number | null;
  tags: string[] | null;
  capacity: number;
  filled_count: number;
  status: Team["status"];
  invite_code: string | null;
  created_at: string;
  team_members: TeamMemberRow[] | null;
};

/** 카드에 찍히는 "방금 전". 서버는 timestamptz 만 주고 표현은 여기서 만든다. */
export const toRelativeTime = (iso: string): string => {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "어제";
  if (days < 7) return `${days}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR");
};

const toTeam = (row: TeamRow, myUserId: string): Team => {
  const members: TeamMember[] = (row.team_members ?? [])
    // 팀장이 맨 앞. 팀원 카드가 배열 순서대로 그려진다.
    .sort((a, b) => Number(b.is_owner) - Number(a.is_owner))
    .map((member) => {
      const profile = member.profiles;
      const nickname = profile?.nickname?.trim();
      return {
        name: nickname || profile?.name || "밋단 회원",
        role: member.is_owner ? "LEADER" : "MEMBER",
        avatarIdx: profile?.avatar_idx ?? 0,
        dept: profile?.dept ?? undefined,
        mbti: profile?.mbti ?? undefined,
        bio: profile?.bio ?? undefined,
      };
    });

  return {
    id: row.id,
    title: row.title,
    content: row.content,
    campus: row.campus,
    dept: row.dept,
    gender: row.gender,
    status: row.status,
    count: row.capacity,
    currentCount: row.filled_count,
    age: row.avg_age,
    tags: row.tags ?? [],
    timestamp: toRelativeTime(row.created_at),
    inviteCode: row.invite_code ?? undefined,
    isOwner: row.owner_id === myUserId,
    members,
  };
};

/** 팀 만들기(write.tsx). dept·gender·avg_age 는 서버가 채우므로 여기 없다. */
export type CreateTeamRequest = {
  title: string;
  content: string;
  campus: "죽전" | "천안";
  /** 정원 (teams.capacity) */
  count: number;
  tags: string[];
};

/** 팀 정보 수정(edit/[id].tsx). 팀장만 저장할 수 있다. */
export type TeamPatch = {
  title: string;
  content: string;
  campus: "죽전" | "천안";
  count: number;
};

/** 세션에서 내 uuid 를 꺼낸다. 없으면 로그인이 풀린 것이다. */
const requireUserId = async (): Promise<string | null> => {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
};

/**
 * 내가 속한 팀 id 들.
 *
 * teams_select 는 게시판에 공개된(ACTIVE) 남의 팀도 통과시키므로
 * '내 팀'과 '남의 팀'을 가르려면 소속을 따로 물어봐야 한다.
 * 내 팀 목록(getMyTeams)은 이걸로 뽑고, 홈 피드(getPosts)는 이걸 빼낸다.
 */
const fetchMyTeamIds = async (
  userId: string,
): Promise<{ ids: string[]; error: PostgrestError | null }> => {
  const { data, error } = await retryOnClockSkew<{ team_id: string }[]>(() =>
    supabase.from("team_members").select("team_id").eq("user_id", userId),
  );
  return { ids: (data ?? []).map((row) => row.team_id), error };
};

// ============================================================
// matches ↔ MatchRequest / Match 매핑
//
// 서버에는 '신청'과 '매칭'이 따로 없다. matches 한 줄의 status 가
//   WAITING  → 신청 (받은 것 / 보낸 것)
//   ACCEPTED → 성사된 매칭 (+ 트리거가 만든 채팅방)
//   REJECTED → 거절된 신청
// 으로 옮겨 다닐 뿐이다. 화면이 나눠 보는 건 여기서 나눈다.
// ============================================================

/**
 * teams 로 가는 외래키가 둘(from_team_id / to_team_id)이라 PostgREST 가
 * 어느 쪽을 붙일지 스스로 고르지 못한다. `!컬럼명` 으로 짚어 준다.
 * (제약 이름 `!matches_from_team_id_fkey` 도 같은 뜻이지만, 컬럼 이름이
 *  스키마를 어떻게 만들었든 그대로다.)
 *
 * 상대 팀 행이 보이는 근거는 마이그레이션 009 의 is_match_counterpart_team
 * 이다. 그게 없으면 비공개(READY) 팀이 보낸 신청은 이름 없는 줄이 된다.
 */
const MATCH_COLUMNS =
  "id, from_team_id, to_team_id, status, created_at, responded_at, plan_date, plan_time, plan_place";

const MATCH_SELECT = `${MATCH_COLUMNS},
  from_team:teams!from_team_id(${TEAM_SELECT}),
  to_team:teams!to_team_id(${TEAM_SELECT})`;

/** 매칭 목록은 채팅방 id 까지 필요하다 (chat_rooms.match_id 는 unique) */
const MATCH_WITH_ROOM_SELECT = `${MATCH_SELECT}, chat_rooms(id, closed_at)`;

type ChatRoomRow = { id: string; closed_at: string | null };

type MatchRow = {
  id: string;
  from_team_id: string;
  to_team_id: string;
  status: MatchRequest["status"];
  created_at: string;
  responded_at: string | null;
  plan_date: string | null;
  /** "19:00:00" 처럼 초까지 온다 */
  plan_time: string | null;
  plan_place: string | null;
  /** 차단 등으로 상대 팀 행이 안 보이면 null 이다 */
  from_team: TeamRow | null;
  to_team: TeamRow | null;
  /** unique 제약을 PostgREST 가 못 알아보면 배열로 온다. 둘 다 받아준다. */
  chat_rooms?: ChatRoomRow[] | ChatRoomRow | null;
};

const readRoomId = (rooms: MatchRow["chat_rooms"]): string | undefined => {
  if (!rooms) return undefined;
  return Array.isArray(rooms) ? rooms[0]?.id : rooms.id;
};

/** "2026. 8. 22." — 활동 탭이 매칭 시작일을 이 모양으로 그린다 */
const toDateLabel = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
};

const toPlan = (row: MatchRow): ConfirmedPlan | undefined => {
  // 스키마 제약상 날짜와 시각은 항상 함께 있거나 함께 없다
  if (!row.plan_date || !row.plan_time) return undefined;
  return {
    date: row.plan_date,
    time: row.plan_time.slice(0, 5),
    place: row.plan_place ?? "",
  };
};

/**
 * 신청 한 줄을 '보는 사람 기준'으로 뒤집는다.
 * 상대 팀이 안 보이면(차단 등) 그릴 수 없는 줄이므로 null 로 걸러낸다.
 */
const toMatchRequest = (
  row: MatchRow,
  myTeamIds: Set<string>,
  myUserId: string,
): MatchRequest | null => {
  const received = myTeamIds.has(row.to_team_id);
  const partnerRow = received ? row.from_team : row.to_team;
  if (!partnerRow) return null;

  return {
    id: row.id,
    status: row.status,
    timestamp: toRelativeTime(row.created_at),
    received,
    myTeamId: received ? row.to_team_id : row.from_team_id,
    partnerTeam: toTeam(partnerRow, myUserId),
  };
};

const toMatch = (
  row: MatchRow,
  myTeamIds: Set<string>,
  myUserId: string,
): { match: Match; partnerTeam?: Team } => {
  const mineIsFrom = myTeamIds.has(row.from_team_id);
  const partnerRow = mineIsFrom ? row.to_team : row.from_team;
  const partnerTeam = partnerRow ? toTeam(partnerRow, myUserId) : undefined;

  return {
    partnerTeam,
    match: {
      id: row.id,
      myTeamId: mineIsFrom ? row.from_team_id : row.to_team_id,
      partnerTeamId: mineIsFrom ? row.to_team_id : row.from_team_id,
      partnerTeamName: partnerTeam?.title ?? "알 수 없는 팀",
      startedAt: toDateLabel(row.responded_at ?? row.created_at),
      roomId: readRoomId(row.chat_rooms),
      confirmedPlan: toPlan(row),
    },
  };
};

// ============================================================
// chat_rooms / messages ↔ ChatMessage 매핑
//
// 방 하나는 매칭 하나에 붙어 있다(chat_rooms.match_id 는 unique).
// 화면 경로는 /chat/[매칭id] 라서 방 id 는 매칭에서 찾아 들어간다.
// ============================================================

/**
 * 서버가 올리는 채팅 쪽 문구. send_chat_message(마이그레이션 011) 와
 * post_system_message / post_exit_proposal / resolve_exit_proposal 이 던진다.
 */
const CHAT_ERROR_MESSAGES = [
  "이 채팅방의 참여자가 아닙니다",
  "이미 종료된 채팅방입니다",
  "메시지를 보낼 수 없는 계정입니다",
  "메시지 id 가 중복되었습니다",
  "처리할 종료 제안이 없습니다",
  "잘못된 값입니다",
];

const describeChatError = (error: { message: string; code?: string }): string => {
  const known = CHAT_ERROR_MESSAGES.find((m) => error.message.includes(m));
  if (known) return known;

  /*
   * 42501 = RLS 위반.
   * 마이그레이션 011 이후 messages 직접 insert 는 정책(messages_insert_denied)이
   * 항상 막는다. 여기로 42501 이 올라온다는 건 화면이 Edge Function 을 거치지
   * 않고 테이블에 직접 쓰려 했다는 뜻이라, 사용자 문구보다 개발자 로그가 중요하다.
   */
  if (error.code === "42501") {
    console.error("[채팅 RLS 거부]", error.message);
    return "메시지를 보낼 수 없어요. 앱을 최신 버전으로 업데이트해주세요.";
  }

  return describeDbError(error as PostgrestError);
};

/** deleted_at 은 안 가져온다. messages_select 가 이미 걸러서 내려준다. */
const MESSAGE_COLUMNS =
  "id, room_id, sender_id, kind, content, proposal_result, is_filtered, created_at";

type MessageRow = {
  id: string;
  room_id: string;
  /** system / proposal 메시지는 보낸 사람이 없다 */
  sender_id: string | null;
  kind: "user" | "system" | "proposal";
  content: string;
  proposal_result: "ACCEPT" | "REJECT" | null;
  is_filtered: boolean;
  created_at: string;
};

/**
 * 말풍선 하나.
 *
 * '내 것이냐 상대 것이냐'는 여기서 정하지 않는다. 화면이 currentUser.id 와
 * senderId 를 비교해서 정한다 — 같은 줄을 두 사람이 서로 반대로 봐야 하므로
 * 서버 모양에 그 판단을 섞으면 안 된다.
 */
export type ChatMessage = {
  id: string;
  roomId: string;
  senderId: string | null;
  kind: "user" | "system" | "proposal";
  text: string;
  /** 종료 제안 카드의 결정. 아직 아무도 안 눌렀으면 undefined */
  proposalResult?: "ACCEPT" | "REJECT";
  /** 금지어가 마스킹된 메시지 (filter-message 가 판단해 기록한다) */
  isFiltered: boolean;
  /** ISO 문자열. "오후 12:01" 같은 표현은 화면에서 만든다 */
  createdAt: string;
};

const toChatMessage = (row: MessageRow): ChatMessage => ({
  id: row.id,
  roomId: row.room_id,
  senderId: row.sender_id,
  kind: row.kind,
  text: row.content,
  proposalResult: row.proposal_result ?? undefined,
  isFiltered: row.is_filtered,
  createdAt: row.created_at,
});

export type ChatRoom = {
  id: string;
  matchId: string;
  /** 종료 제안에 양쪽이 동의하면 찍힌다. 차 있으면 입력창을 닫아야 한다. */
  closedAt: string | null;
};

/** 채팅방 서랍(참여자 목록)이 그리는 한 사람. */
export type ChatParticipant = {
  /** profiles.id — messages.sender_id 와 맞춰 쓴다 */
  id: string;
  name: string;
  dept: string;
  team: "MINE" | "PARTNER";
  isLeader: boolean;
  avatarIdx: number;
};

/** 참여자 목록에 필요한 만큼만. 팀 카드(TEAM_SELECT)와 달리 user_id 가 있어야 한다. */
const CHAT_TEAM_SELECT =
  "id, owner_id, title, dept, capacity, team_members(user_id, is_owner, profiles(name, nickname, dept, avatar_idx))";

type ChatTeamRow = {
  id: string;
  owner_id: string;
  title: string;
  dept: string;
  capacity: number;
  team_members:
    | {
        user_id: string;
        is_owner: boolean;
        /** 차단한 상대는 profiles_select 가 가려서 null 로 온다 */
        profiles: {
          name: string;
          nickname: string | null;
          dept: string;
          avatar_idx: number;
        } | null;
      }[]
    | null;
};

const toParticipants = (
  team: ChatTeamRow | null,
  side: "MINE" | "PARTNER",
): ChatParticipant[] =>
  (team?.team_members ?? [])
    // 팀장이 맨 앞. 서랍이 배열 순서대로 그린다.
    .sort((a, b) => Number(b.is_owner) - Number(a.is_owner))
    .map((member) => {
      const nickname = member.profiles?.nickname?.trim();
      return {
        id: member.user_id,
        name: nickname || member.profiles?.name || "밋단 회원",
        // 프로필이 가려졌으면 팀 학과로 대신한다(팀은 동성·같은 과 기준이라 대개 맞다)
        dept: member.profiles?.dept ?? team?.dept ?? "",
        team: side,
        isLeader: member.is_owner,
        avatarIdx: member.profiles?.avatar_idx ?? 0,
      };
    });

/**
 * 메시지 id 를 클라이언트가 만든다.
 *
 * Realtime 은 내가 보낸 메시지도 되돌려준다. id 가 보내기 전에 정해져 있으면
 * 화면에 먼저 그려둔 말풍선을 그냥 같은 id 로 덮어쓰면 되어서, 임시 id 를
 * 실제 id 로 바꿔치는 로직이 통째로 없어진다. 재전송해도 서버가 같은 id 를
 * 중복으로 넣지 않는다(send_chat_message 의 on conflict).
 *
 * Hermes 에는 crypto 가 없을 수 있어 Math.random 으로 물러선다. 이 값은
 * 비밀이 아니라 '같은 메시지인지' 가리는 꼬리표라 그 정도면 충분하다.
 */
export const newMessageId = (): string => {
  const g = globalThis as {
    crypto?: { randomUUID?: () => string };
  };
  if (typeof g.crypto?.randomUUID === "function") return g.crypto.randomUUID();

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
};

/**
 * 메시지 전송 창구.
 *
 * 마이그레이션 011 이후 messages 직접 insert 는 막혀 있다. 이 함수만이
 * 금지어를 거른 뒤 서버에 넣을 수 있다(is_filtered / filter_note 도 여기서만
 * 채워진다). 화면의 utils/profanity 는 왕복 전에 미리 알려주는 편의일 뿐,
 * 판정의 주인은 이쪽이다.
 *
 *   요청 { room_id, content, message_id? }
 *   응답 { allowed: true, message, was_filtered } | { blocked: true, error }
 */
const FILTER_MESSAGE_FN = "filter-message";

// ============================================================
// notifications ↔ AppNotification 매핑
//
// 문구는 서버가 만들어 둔 그대로 나른다(마이그레이션 012). 여기서 하는 일은
// 컬럼 이름을 카멜케이스로 바꾸고, read_at 을 isRead 로 접는 것뿐이다.
// ============================================================

const NOTIFICATION_COLUMNS =
  "id, kind, title, body, team_id, match_id, room_id, read_at, created_at";

type NotificationRow = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  team_id: string | null;
  match_id: string | null;
  room_id: string | null;
  read_at: string | null;
  created_at: string;
};

const toNotification = (row: NotificationRow): AppNotification => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  body: row.body,
  teamId: row.team_id ?? undefined,
  matchId: row.match_id ?? undefined,
  roomId: row.room_id ?? undefined,
  isRead: row.read_at !== null,
  createdAt: row.created_at,
});

export const API = {
  /** 인증번호 발송 */
  requestEmailAuth: async (email: string): Promise<ApiResponse> => {
    if (SKIP_EMAIL_VERIFY) {
      return ok(
        undefined,
        "[개발 모드] 메일을 보내지 않았습니다. 인증번호는 아무 값이나 입력하세요.",
      );
    }

    const { data, error } = await supabase.functions.invoke(VERIFY_EMAIL_FN, {
      body: { email: email.trim().toLowerCase(), action: "send" },
    });

    const result = readFunctionResult(data, error);
    if (!result.ok) {
      return fail(400, result.message ?? "인증번호 발송에 실패했어요.");
    }
    return ok(undefined, "인증번호가 발송되었습니다. 메일함을 확인해주세요.");
  },

  /** 인증번호 확인 */
  verifyEmailCode: async (
    email: string,
    code: string,
  ): Promise<ApiResponse> => {
    if (SKIP_EMAIL_VERIFY) {
      return ok(undefined, "[개발 모드] 이메일 인증을 건너뛰었습니다.");
    }

    const { data, error } = await supabase.functions.invoke(VERIFY_EMAIL_FN, {
      body: {
        email: email.trim().toLowerCase(),
        code: code.trim(),
        action: "verify",
      },
    });

    const result = readFunctionResult(data, error);
    if (!result.ok) {
      return fail(400, result.message ?? "인증번호가 일치하지 않습니다.");
    }
    return ok(undefined, "인증이 완료되었습니다.");
  },

  /**
   * 아이디 중복 확인.
   * profiles 는 로그인 전엔 읽을 수 없으므로(RLS), 아이디→이메일을 해석해 주는
   * resolve-login 을 재사용한다. 해석되면 이미 쓰이는 아이디다.
   */
  checkLoginId: async (loginId: string): Promise<ApiResponse> => {
    const { data, error } = await supabase.functions.invoke("resolve-login", {
      body: { login_id: loginId.trim() },
    });

    // 없는 아이디면 함수가 401 을 준다 = 사용 가능. 정상 흐름이라 로그를 남기지 않는다.
    const result = readFunctionResult<{ email?: string }>(data, error, {
      quiet: true,
    });
    if (!result.ok || !result.data.email) return ok();

    return fail(409, "이미 사용 중인 아이디예요.");
  },

  /**
   * 회원가입.
   *
   * profiles 행은 클라이언트가 직접 넣지 않는다. auth.users 의
   * on_auth_user_created 트리거(마이그레이션 002)가 아래 options.data 를 읽어
   * 같은 트랜잭션 안에서 만들어 준다. 그래서 중간에 실패해도
   * auth.users 에만 행이 남는 일이 없다.
   *
   * ⚠️ 여기 넘기는 키 이름은 handle_new_user() 가 읽는 키와 정확히 같아야 한다.
   *    (login_id / name / gender / campus / dept)
   */
  signup: async (payload: SignupRequest): Promise<ApiResponse<CurrentUser>> => {
    const email = payload.email.trim().toLowerCase();
    const loginId = payload.userId.trim();

    // 아이디가 겹치면 트리거 안에서 unique 위반이 나고 signUp 이 통째로 실패한다.
    // 그때는 원인이 안 보이므로 미리 걸러 둔다.
    const idCheck = await API.checkLoginId(loginId);
    if (idCheck.code !== 200) return fail(idCheck.code, idCheck.message!);

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email,
      password: payload.password,
      options: {
        data: {
          login_id: loginId,
          name: payload.name.trim(),
          gender: payload.gender,
          birth_year: payload.birthYear,
          campus: payload.campus,
          dept: payload.dept,
        },
      },
    });
    if (signUpError) return fail(400, describeAuthError(signUpError.message));

    // "Confirm email" 이 켜져 있으면 세션이 안 온다. 이메일 확인은 verify-email 이
    // 이미 했으므로 꺼두는 게 맞지만, 켜져 있어도 로그인해서 이어가 본다.
    if (!signUpData.session) {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password: payload.password,
      });
      if (signInError) {
        return fail(
          500,
          "계정은 만들어졌지만 로그인에 실패했어요. Supabase Authentication 설정에서 'Confirm email' 을 꺼주세요.",
        );
      }
    }

    // 트리거가 만들어 둔 프로필을 읽어 온다
    const me = await API.getMe();
    if (me.code !== 200) {
      // 프로필 없이 로그인된 상태로 들어가면 화면이 전부 빈다. 세션부터 정리.
      await supabase.auth.signOut();
      return fail(
        500,
        "계정은 만들어졌지만 프로필을 읽지 못했어요. 잠시 후 로그인해주세요.",
      );
    }

    return ok(me.data!, "회원가입이 완료되었습니다.");
  },

  /**
   * 로그인. 화면에서는 아이디로 받지만 Supabase Auth 는 이메일로만 로그인한다.
   * resolve-login Edge Function 이 아이디 → 이메일을 해석해 준다.
   */
  login: async (
    loginId: string,
    password: string,
  ): Promise<ApiResponse<CurrentUser>> => {
    const { data, error } = await supabase.functions.invoke("resolve-login", {
      body: { login_id: loginId.trim() },
    });

    const resolved = readFunctionResult<{ email?: string }>(data, error);
    // 없는 아이디인지 틀린 비밀번호인지 구분해서 알려주지 않는다(계정 존재 여부 노출 방지)
    const WRONG = "아이디 또는 비밀번호가 올바르지 않습니다.";
    if (!resolved.ok || !resolved.data.email) return fail(401, WRONG);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: resolved.data.email,
      password,
    });
    if (signInError) return fail(401, WRONG);

    const me = await API.getMe();
    if (me.code !== 200) {
      // 프로필이 없는 반쪽 계정. 들여보내면 빈 화면만 보인다.
      await supabase.auth.signOut();
      return fail(me.code, me.message ?? "로그인에 실패했어요.");
    }
    return me;
  },

  /** 저장된 세션으로 내 정보 가져오기. 앱 재시작 시 복원에도 쓴다. */
  getMe: async (): Promise<ApiResponse<CurrentUser>> => {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id;
    if (!userId) return fail(401, "로그인이 필요합니다.");

    const read = () =>
      supabase
        .from("profiles")
        .select(PROFILE_COLUMNS)
        .eq("id", userId)
        .maybeSingle<ProfileRow>();

    let { data: row, error } = await read();

    // 가입·로그인 직후 첫 쿼리가 PGRST303 으로 튕기는 경합을 흡수한다.
    // 잠깐 쉬었다 다시 물어보면 통과한다.
    for (let attempt = 0; attempt < 2 && isClockSkewError(error); attempt++) {
      await sleep(1200);
      ({ data: row, error } = await read());
    }

    if (error) return fail(500, describeDbError(error));
    if (!row) return fail(404, "프로필 정보를 찾을 수 없습니다.");
    if (row.deleted_at) return fail(403, "탈퇴한 계정이에요.");
    if (row.status === "suspended") {
      return fail(403, "이용이 제한된 계정이에요. 고객센터로 문의해주세요.");
    }

    return ok(toCurrentUser(row));
  },

  /** 마이 탭 프로필 저장 */
  updateMyProfile: async (
    patch: ProfilePatch,
  ): Promise<ApiResponse<CurrentUser>> => {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id;
    if (!userId) return fail(401, "로그인이 필요합니다.");

    const { data: row, error } = await supabase
      .from("profiles")
      .update({
        // 빈 문자열은 스키마 check(길이 1 이상)에 걸린다. '지움'은 null 로 보낸다.
        nickname: patch.nickname.trim() || null,
        bio: patch.bio.trim() || null,
        mbti: patch.mbti.trim() || null,
        avatar_idx: patch.avatarIdx,
      })
      .eq("id", userId)
      .select(PROFILE_COLUMNS)
      .single<ProfileRow>();

    if (error) return fail(400, describeDbError(error));
    return ok(toCurrentUser(row), "프로필이 저장되었습니다.");
  },

  // ============================================================
  // 팀
  // ============================================================

  /** 팀 하나를 다시 읽어온다. 쓰기 직후 트리거 결과까지 반영된 값이 필요할 때. */
  getTeam: async (teamId: string): Promise<ApiResponse<Team>> => {
    const userId = await requireUserId();
    if (!userId) return fail(401, "로그인이 필요합니다.");

    const { data, error } = await supabase
      .from("teams")
      .select(TEAM_SELECT)
      .eq("id", teamId)
      .maybeSingle<TeamRow>();

    if (error) return fail(500, describeTeamError(error));
    if (!data) return fail(404, "팀을 찾을 수 없어요.");
    return ok(toTeam(data, userId));
  },

  /** 내가 속한 팀 전부 — 내가 만든 팀 + 초대 코드로 합류한 팀. */
  getMyTeams: async (): Promise<ApiResponse<Team[]>> => {
    const userId = await requireUserId();
    if (!userId) return fail(401, "로그인이 필요합니다.");

    const { ids: teamIds, error: memberError } = await fetchMyTeamIds(userId);
    if (memberError) return fail(500, describeTeamError(memberError));
    if (teamIds.length === 0) return ok([]);

    const { data, error } = await supabase
      .from("teams")
      .select(TEAM_SELECT)
      .in("id", teamIds)
      .order("created_at", { ascending: false })
      .returns<TeamRow[]>();

    if (error) return fail(500, describeTeamError(error));
    return ok((data ?? []).map((row) => toTeam(row, userId)));
  },

  /**
   * 홈 피드(게시판) — 다른 사람들이 올린 팀 목록.
   *
   * 무엇이 보이는지는 서버가 정한다.
   *   · 공개된 팀만        — status = 'ACTIVE'
   *                          (정원이 차야 공개할 수 있고, 매칭되면 MATCHED 로 내려간다)
   *   · 차단 관계는 제외    — teams_select 의 is_blocked_with_team 이 알아서 가린다
   * 여기서 한 겹 더 거르는 건 '내가 속한 팀'뿐이다. 내 팀은 [내 팀] 탭에서
   * 관리하는 것이고, 자기 팀에 신청할 수도 없으니 피드에 있을 이유가 없다.
   *
   * ⚠️ 남의 팀은 team_members 정책(팀원·매칭 상대만 조회 가능)에 걸려
   *    members 가 빈 배열로 온다. 카드는 members 를 쓰지 않아 홈 피드는 멀쩡하지만,
   *    상세 화면의 팀원 목록을 채우려면 마이그레이션 007 이 필요하다.
   */
  getPosts: async (): Promise<ApiResponse<Team[]>> => {
    const userId = await requireUserId();
    if (!userId) return fail(401, "로그인이 필요합니다.");

    const { ids: myTeamIds, error: memberError } = await fetchMyTeamIds(userId);
    if (memberError) return fail(500, describeTeamError(memberError));

    const { data, error } = await retryOnClockSkew<TeamRow[]>(() => {
      const query = supabase
        .from("teams")
        .select(TEAM_SELECT)
        .eq("status", "ACTIVE")
        .order("created_at", { ascending: false });

      // in 필터는 값이 없으면 "()" 가 되어 문법 오류가 난다. 있을 때만 붙인다.
      return (
        myTeamIds.length > 0
          ? query.not("id", "in", `(${myTeamIds.join(",")})`)
          : query
      ).returns<TeamRow[]>();
    });

    if (error) return fail(500, describeTeamError(error));
    return ok((data ?? []).map((row) => toTeam(row, userId)));
  },

  /**
   * 팀 만들기.
   *
   * team_members 는 직접 넣지 않는다. teams_add_owner 트리거가 팀장을
   * 같은 트랜잭션에서 등록하고, 그 insert 가 team_members_sync_fill 을 깨워
   * filled_count / status 를 맞춘다. 클라이언트가 한 번 더 넣으면
   * 중복키(23505)로 팀 생성 자체가 실패한다.
   */
  createTeam: async (
    payload: CreateTeamRequest,
  ): Promise<ApiResponse<Team>> => {
    const userId = await requireUserId();
    if (!userId) return fail(401, "로그인이 필요합니다.");

    const { data, error } = await supabase
      .from("teams")
      .insert({
        owner_id: userId,
        title: payload.title.trim(),
        content: payload.content.trim(),
        campus: payload.campus,
        capacity: payload.count,
        tags: payload.tags,
      })
      .select("id")
      .single<{ id: string }>();

    if (error) return fail(400, describeTeamError(error));

    // 방금 만든 행을 그대로 쓰면 안 된다. filled_count / status 를 채우는
    // 트리거는 insert 가 끝난 뒤에 돌아서, 여기 돌아온 값은 아직 0명짜리다.
    return API.getTeam(data.id);
  },

  /** 팀 정보 수정. teams_update 정책상 팀장만 통과한다. */
  updateTeam: async (
    teamId: string,
    patch: TeamPatch,
  ): Promise<ApiResponse<Team>> => {
    const { error } = await supabase
      .from("teams")
      .update({
        title: patch.title.trim(),
        content: patch.content.trim(),
        campus: patch.campus,
        capacity: patch.count,
      })
      .eq("id", teamId);

    if (error) return fail(400, describeTeamError(error));
    return API.getTeam(teamId);
  },

  /**
   * 게시판 공개 / 비공개 전환.
   * 정원이 차야 공개할 수 있고, 그 검사는 teams_guard_publish 트리거가 한다.
   */
  setTeamPublic: async (
    teamId: string,
    isPublic: boolean,
  ): Promise<ApiResponse<Team>> => {
    const { error } = await supabase
      .from("teams")
      .update({ status: isPublic ? "ACTIVE" : "READY" })
      .eq("id", teamId);

    if (error) return fail(400, describeTeamError(error));
    return API.getTeam(teamId);
  },

  /** 팀 삭제. 팀장만. team_members 는 cascade 로 함께 지워진다. */
  deleteTeam: async (teamId: string): Promise<ApiResponse> => {
    const { error } = await supabase.from("teams").delete().eq("id", teamId);
    if (error) return fail(400, describeTeamError(error));
    return ok(undefined, "팀을 삭제했어요.");
  },

  /** 팀 나가기. 팀장이 아닌 사람이 쓰는 길. */
  leaveTeam: async (teamId: string): Promise<ApiResponse> => {
    const userId = await requireUserId();
    if (!userId) return fail(401, "로그인이 필요합니다.");

    const { error } = await supabase
      .from("team_members")
      .delete()
      .eq("team_id", teamId)
      .eq("user_id", userId);

    if (error) return fail(400, describeTeamError(error));
    return ok(undefined, "팀에서 나왔어요.");
  },

  /**
   * 초대 코드로 참여.
   *
   * 코드로 들어갈 팀은 대개 비공개(RECRUITING)라 teams_select 로는 찾을 수 없다.
   * join_team_by_code RPC 가 security definer 로 그 한 겹만 열어 준다.
   */
  joinTeamByCode: async (code: string): Promise<ApiResponse<Team>> => {
    const { data, error } = await supabase.rpc("join_team_by_code", {
      p_code: code.trim().toUpperCase(),
    });

    // 코드가 틀렸거나 정원이 찼거나 — 전부 정상 흐름이라 문구가 이미 한국어다.
    if (error) return fail(400, describeTeamError(error));
    if (!data) return fail(404, "초대 코드를 찾을 수 없습니다");

    return API.getTeam(data as string);
  },

  // ============================================================
  // 매칭 — 신청 / 수락 / 거절
  // ============================================================

  /**
   * 매칭 신청.
   *
   * 규칙(이성 팀 / 같은 인원 / 공개된 팀 / 우리 팀 인원 충족 / 매칭 안 된 팀)은
   * 전부 서버가 본다. 화면에서 먼저 걸러 주는 건 왕복을 줄이려는 것뿐이고,
   * 최종 판단은 assert_match_request_valid 트리거가 한다.
   *
   * .select() 를 붙이지 않는다. 붙이면 INSERT ... RETURNING 이 되어
   * SELECT 정책까지 통과해야 하고(마이그레이션 008 참고), 여기서는
   * 돌려받을 값도 딱히 없다.
   */
  sendMatchRequest: async (
    myTeamId: string,
    targetTeamId: string,
  ): Promise<ApiResponse> => {
    const { error } = await supabase
      .from("matches")
      .insert({ from_team_id: myTeamId, to_team_id: targetTeamId });

    if (error) return fail(400, describeMatchError(error));
    return ok(undefined, "신청을 보냈어요.");
  },

  /**
   * 받은 신청 / 보낸 신청.
   *
   * 무엇이 내려오는지는 matches_select 가 정한다(내 팀이 한쪽에 걸린 줄만).
   * 방향만 여기서 가른다 — 내 팀이 받는 쪽이면 '받은 신청'이다.
   */
  getMatchRequests: async (): Promise<
    ApiResponse<{ received: MatchRequest[]; sent: MatchRequest[] }>
  > => {
    const userId = await requireUserId();
    if (!userId) return fail(401, "로그인이 필요합니다.");

    const { ids: myTeamIds, error: memberError } = await fetchMyTeamIds(userId);
    if (memberError) return fail(500, describeMatchError(memberError));
    if (myTeamIds.length === 0) return ok({ received: [], sent: [] });

    const { data, error } = await retryOnClockSkew<MatchRow[]>(() =>
      supabase
        .from("matches")
        .select(MATCH_SELECT)
        .order("created_at", { ascending: false })
        .returns<MatchRow[]>(),
    );

    if (error) return fail(500, describeMatchError(error));

    const mine = new Set(myTeamIds);
    const rows = (data ?? [])
      .map((row) => toMatchRequest(row, mine, userId))
      .filter((row): row is MatchRequest => row !== null);

    return ok({
      received: rows.filter((r) => r.received),
      sent: rows.filter((r) => !r.received),
    });
  },

  /** 신청 한 건. 수락/거절 화면이 자기 데이터를 직접 읽어온다. */
  getMatchRequest: async (
    matchId: string,
  ): Promise<ApiResponse<MatchRequest>> => {
    const userId = await requireUserId();
    if (!userId) return fail(401, "로그인이 필요합니다.");

    const { ids: myTeamIds, error: memberError } = await fetchMyTeamIds(userId);
    if (memberError) return fail(500, describeMatchError(memberError));

    const { data, error } = await supabase
      .from("matches")
      .select(MATCH_WITH_ROOM_SELECT)
      .eq("id", matchId)
      .maybeSingle<MatchRow>();

    if (error) return fail(500, describeMatchError(error));
    if (!data) return fail(404, "신청을 찾을 수 없어요.");

    const request = toMatchRequest(data, new Set(myTeamIds), userId);
    if (!request) return fail(404, "상대 팀 정보를 볼 수 없어요.");
    return ok(request);
  },

  /**
   * 수락. 여기서 시작되는 연쇄는 전부 서버 안에서 끝난다.
   *   on_match_accepted → 채팅방 생성 → 두 팀 MATCHED → 나머지 신청 자동 거절
   * 그래서 화면은 결과를 흉내 내지 않고 다시 읽기만 한다.
   *
   * .select() 를 붙이는 이유: 정책에 막혀 0행이 바뀌어도 PostgREST 는
   * 조용히 성공을 돌려준다. 바뀐 행을 되받아야 "정말 수락됐는가"를 안다.
   */
  acceptMatchRequest: async (matchId: string): Promise<ApiResponse<Match>> => {
    const { data, error } = await supabase
      .from("matches")
      .update({ status: "ACCEPTED" })
      .eq("id", matchId)
      .select("id")
      .maybeSingle<{ id: string }>();

    if (error) return fail(400, describeMatchError(error));
    if (!data) return fail(403, "이 신청을 수락할 권한이 없어요.");

    return API.getMatch(matchId);
  },

  /** 거절. 받은 팀 팀장이 거절, 보낸 팀 팀장이 취소 — 서버에서는 같은 한 줄이다. */
  rejectMatchRequest: async (matchId: string): Promise<ApiResponse> => {
    const { data, error } = await supabase
      .from("matches")
      .update({ status: "REJECTED" })
      .eq("id", matchId)
      .select("id")
      .maybeSingle<{ id: string }>();

    if (error) return fail(400, describeMatchError(error));
    if (!data) return fail(403, "이 신청을 처리할 권한이 없어요.");

    return ok(undefined, "신청을 거절했어요.");
  },

  /** 성사된 매칭 하나. 수락 직후 채팅방으로 넘어갈 때 쓴다. */
  getMatch: async (matchId: string): Promise<ApiResponse<Match>> => {
    const userId = await requireUserId();
    if (!userId) return fail(401, "로그인이 필요합니다.");

    const { ids: myTeamIds, error: memberError } = await fetchMyTeamIds(userId);
    if (memberError) return fail(500, describeMatchError(memberError));

    const { data, error } = await supabase
      .from("matches")
      .select(MATCH_WITH_ROOM_SELECT)
      .eq("id", matchId)
      .maybeSingle<MatchRow>();

    if (error) return fail(500, describeMatchError(error));
    if (!data) return fail(404, "매칭을 찾을 수 없어요.");

    return ok(toMatch(data, new Set(myTeamIds), userId).match);
  },

  /**
   * 성사된 매칭 전부 (활동 탭의 [매칭] / 채팅방 목록).
   * 상대 팀도 함께 돌려준다 — 매칭된 팀은 게시판에서 내려가므로 posts 에서
   * 찾을 수 없고, 채팅 헤더가 학과·인원을 여기서 가져간다.
   */
  getMyMatches: async (): Promise<
    ApiResponse<{ matches: Match[]; partnerTeams: Team[] }>
  > => {
    const userId = await requireUserId();
    if (!userId) return fail(401, "로그인이 필요합니다.");

    const { ids: myTeamIds, error: memberError } = await fetchMyTeamIds(userId);
    if (memberError) return fail(500, describeMatchError(memberError));
    if (myTeamIds.length === 0) return ok({ matches: [], partnerTeams: [] });

    const { data, error } = await retryOnClockSkew<MatchRow[]>(() =>
      supabase
        .from("matches")
        .select(MATCH_WITH_ROOM_SELECT)
        .eq("status", "ACCEPTED")
        .order("responded_at", { ascending: false })
        .returns<MatchRow[]>(),
    );

    if (error) return fail(500, describeMatchError(error));

    const mine = new Set(myTeamIds);
    const mapped = (data ?? []).map((row) => toMatch(row, mine, userId));

    return ok({
      matches: mapped.map((m) => m.match),
      partnerTeams: mapped
        .map((m) => m.partnerTeam)
        .filter((team): team is Team => team !== undefined),
    });
  },

  /**
   * 약속 확정 / 변경.
   *
   * matches_update 정책은 팀장만 통과시키는데, 채팅방의 '약속 잡기' 는
   * 팀원도 누를 수 있어야 한다. Postgres RLS 에는 컬럼 단위가 없어
   * 정책을 넓히면 팀원이 수락·거절까지 하게 되므로, 약속만 여는
   * set_match_plan RPC 를 쓴다.
   */
  setMatchPlan: async (
    matchId: string,
    plan: ConfirmedPlan,
  ): Promise<ApiResponse> => {
    const { error } = await supabase.rpc("set_match_plan", {
      p_match_id: matchId,
      p_date: plan.date,
      p_time: plan.time,
      // 장소는 비워둘 수 있다. 빈 문자열 대신 null 로 보낸다.
      p_place: plan.place.trim() || null,
    });

    if (error) return fail(400, describeMatchError(error));
    return ok(undefined, "약속을 저장했어요.");
  },

  /** 약속 취소. 날짜·시각은 함께 비어야 한다(스키마 제약). */
  clearMatchPlan: async (matchId: string): Promise<ApiResponse> => {
    const { error } = await supabase.rpc("set_match_plan", {
      p_match_id: matchId,
      p_date: null,
      p_time: null,
      p_place: null,
    });

    if (error) return fail(400, describeMatchError(error));
    return ok(undefined, "약속을 취소했어요.");
  },

  // ==========================================================
  // 채팅
  // ==========================================================

  /**
   * 매칭 id 로 채팅방을 찾는다. 방은 수락 트리거가 이미 만들어 뒀다.
   *
   * closedAt 이 차 있으면 종료된 방이다. 지난 대화는 계속 읽히지만
   * 새 메시지는 서버가 거절하므로(send_chat_message) 입력창을 닫아야 한다.
   */
  getChatRoom: async (matchId: string): Promise<ApiResponse<ChatRoom>> => {
    const { data, error } = await retryOnClockSkew<{
      id: string;
      match_id: string;
      closed_at: string | null;
    }>(() =>
      supabase
        .from("chat_rooms")
        .select("id, match_id, closed_at")
        .eq("match_id", matchId)
        .maybeSingle(),
    );

    if (error) return fail(500, describeChatError(error));
    // 방이 안 보이는 건 대개 '없어서'가 아니라 chat_rooms_select 에 걸려서다
    if (!data) return fail(404, "채팅방을 찾을 수 없어요.");

    return ok({
      id: data.id,
      matchId: data.match_id,
      closedAt: data.closed_at,
    });
  },

  /**
   * 메시지를 최신순으로 가져온다.
   *
   * ⚠️ 정렬이 '최신이 배열 앞'이다. idx_messages_room(room_id, created_at desc)
   *    을 그대로 타고, inverted FlatList 에 그대로 꽂을 수 있다.
   *    오래된 순으로 그리려면 화면에서 뒤집는다.
   *
   * 과거를 더 불러올 땐 화면에 있는 가장 오래된 메시지의 createdAt 을
   * before 로 넘긴다. 같은 시각(마이크로초까지)에 두 줄이 들어오면 경계에서
   * 한 줄이 빠질 수 있는데, 화면이 어차피 id 로 합치므로 실제로는 드러나지 않는다.
   */
  getChatMessages: async (
    roomId: string,
    options?: { before?: string; limit?: number },
  ): Promise<ApiResponse<ChatMessage[]>> => {
    const limit = options?.limit ?? 50;

    const { data, error } = await retryOnClockSkew<MessageRow[]>(() => {
      let query = supabase
        .from("messages")
        .select(MESSAGE_COLUMNS)
        .eq("room_id", roomId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (options?.before) query = query.lt("created_at", options.before);
      return query.returns<MessageRow[]>();
    });

    if (error) return fail(500, describeChatError(error));
    return ok((data ?? []).map(toChatMessage));
  },

  /**
   * 메시지 전송.
   *
   * messageId 를 미리 만들어 두고 화면에 말풍선을 먼저 그린 뒤 부르면 된다
   * (newMessageId). 실패해도 같은 id 로 다시 부르면 중복이 생기지 않는다.
   *
   * 금지어에 걸리면 code 422 로 돌아온다. 이때는 서버에 아무것도 남지
   * 않았으므로 화면은 낙관적으로 그린 말풍선을 지우고 입력값은 그대로 둔다.
   */
  sendChatMessage: async (
    roomId: string,
    content: string,
    messageId: string = newMessageId(),
  ): Promise<ApiResponse<ChatMessage>> => {
    const text = content.trim();
    if (!text) return fail(400, "내용을 입력해주세요.");

    const { data, error } = await supabase.functions.invoke(FILTER_MESSAGE_FN, {
      body: { room_id: roomId, content: text, message_id: messageId },
    });

    // 금지어 차단은 오류가 아니라 정상적인 거절이라 따로 가른다.
    if (!error && (data as { blocked?: boolean } | null)?.blocked) {
      const blocked = data as { error?: string };
      return fail(422, blocked.error ?? "부적절한 표현이 포함되어 있어요.");
    }

    const result = readFunctionResult<{
      allowed?: boolean;
      message?: MessageRow;
      was_filtered?: boolean;
    }>(data, error);

    if (!result.ok) {
      return fail(400, result.message ?? "메시지를 보내지 못했어요.");
    }
    if (!result.data.message) {
      // 함수는 200 인데 행이 없다 = filter-message 배포본이 낡았다
      // (마이그레이션 011 이전 버전은 판정만 하고 넣지 않는다)
      console.error("[채팅] filter-message 가 메시지를 돌려주지 않았습니다");
      return fail(500, "메시지를 보내지 못했어요.");
    }

    return ok(toChatMessage(result.data.message));
  },

  /**
   * 방 하나를 실시간으로 듣는다. 해지 함수를 돌려준다.
   *
   * 다른 함수들과 달리 ApiResponse 봉투를 쓰지 않는다. 한 번 묻고 답을 받는
   * 호출이 아니라 계속 열려 있는 통로라서, useEffect 의 정리 함수로 그대로
   * 돌려주는 편이 화면에서 다루기 쉽다.
   *
   *   useEffect(() => API.subscribeToChatRoom(roomId, onEvent), [roomId]);
   *
   * INSERT 만 듣지 않는 이유: 종료 제안 카드의 결정(proposal_result)은
   * UPDATE 로 찍힌다. 그걸 안 들으면 제안을 보낸 쪽 화면이 영원히 대기 상태다.
   *
   * 구독에도 RLS 가 적용된다. 내가 차단한 사람의 메시지는 애초에 도착하지
   * 않으므로 화면에서 따로 거를 필요가 없다. 반대로 신고로 삭제된 메시지도
   * 정책에 걸려 이벤트가 안 오므로, 이미 그려진 말풍선은 다시 들어와야 사라진다.
   */
  subscribeToChatRoom: (
    roomId: string,
    onEvent: (event: { type: "INSERT" | "UPDATE"; message: ChatMessage }) => void,
  ): (() => void) => {
    const filter = `room_id=eq.${roomId}`;
    const channel = supabase
      .channel(`room:${roomId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter },
        (payload) =>
          onEvent({
            type: "INSERT",
            message: toChatMessage(payload.new as MessageRow),
          }),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter },
        (payload) =>
          onEvent({
            type: "UPDATE",
            message: toChatMessage(payload.new as MessageRow),
          }),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },

  /**
   * 채팅방 참여자 6명(3:3 이면).
   *
   * 어느 쪽이 '내 팀'인지는 팀원 목록에 내 uuid 가 있는지로 가른다.
   * 매칭 행을 한 번 읽으면 양쪽 팀원이 다 딸려오므로 따로 더 묻지 않는다.
   */
  getChatParticipants: async (
    matchId: string,
  ): Promise<ApiResponse<ChatParticipant[]>> => {
    const userId = await requireUserId();
    if (!userId) return fail(401, "로그인이 필요합니다.");

    const { data, error } = await retryOnClockSkew<{
      from_team: ChatTeamRow | null;
      to_team: ChatTeamRow | null;
    }>(() =>
      supabase
        .from("matches")
        .select(
          `from_team:teams!from_team_id(${CHAT_TEAM_SELECT}),
           to_team:teams!to_team_id(${CHAT_TEAM_SELECT})`,
        )
        .eq("id", matchId)
        .maybeSingle(),
    );

    if (error) return fail(500, describeChatError(error));
    if (!data) return fail(404, "매칭을 찾을 수 없어요.");

    const mineIsFrom = (data.from_team?.team_members ?? []).some(
      (member) => member.user_id === userId,
    );

    return ok([
      ...toParticipants(mineIsFrom ? data.from_team : data.to_team, "MINE"),
      ...toParticipants(mineIsFrom ? data.to_team : data.from_team, "PARTNER"),
    ]);
  },

  /**
   * 시스템 메시지. 약속 확정·차단 안내처럼 '누가 보낸 게 아닌' 줄이다.
   *
   * 화면 state 에만 쌓으면 나에게만 보인다. 양쪽에 남아야 하는 안내는
   * 반드시 이걸 거쳐야 한다.
   */
  postSystemMessage: async (
    roomId: string,
    text: string,
  ): Promise<ApiResponse> => {
    const { error } = await supabase.rpc("post_system_message", {
      p_room_id: roomId,
      p_text: text,
    });

    if (error) return fail(400, describeChatError(error));
    return ok();
  },

  /** 채팅 종료 제안 카드를 띄운다. 양쪽 중 누구나 보낼 수 있다. */
  postExitProposal: async (roomId: string): Promise<ApiResponse> => {
    const { error } = await supabase.rpc("post_exit_proposal", {
      p_room_id: roomId,
    });

    if (error) return fail(400, describeChatError(error));
    return ok();
  },

  /**
   * 종료 제안에 답한다.
   * ACCEPT 면 서버가 chat_rooms.closed_at 을 찍고 방이 닫힌다.
   */
  resolveExitProposal: async (
    messageId: string,
    result: "ACCEPT" | "REJECT",
  ): Promise<ApiResponse> => {
    const { error } = await supabase.rpc("resolve_exit_proposal", {
      p_message_id: messageId,
      p_result: result,
    });

    if (error) return fail(400, describeChatError(error));
    return ok();
  },

  // ==========================================================
  // 차단 / 신고
  // ==========================================================

  /**
   * 차단.
   *
   * 이름·학과를 함께 저장하는 게 핵심이다. 차단하는 순간 profiles_select 가
   * 그 사람을 가려버려서, 스냅샷이 없으면 settings/blocked.tsx 가 이름 없는
   * 빈 목록이 된다.
   *
   * 이미 차단한 상대면 조용히 성공으로 둔다(기본키가 blocker+blocked 라
   * 그냥 넣으면 23505 가 난다).
   */
  blockUser: async (user: {
    id: string;
    name: string;
    dept?: string;
    /** chat_rooms.id — 어느 방에서 차단했는지 */
    roomId?: string;
  }): Promise<ApiResponse> => {
    const userId = await requireUserId();
    if (!userId) return fail(401, "로그인이 필요합니다.");

    const { error } = await supabase.from("blocks").upsert(
      {
        blocker_id: userId,
        blocked_id: user.id,
        room_id: user.roomId ?? null,
        blocked_name: user.name,
        blocked_dept: user.dept ?? null,
      },
      { onConflict: "blocker_id,blocked_id" },
    );

    if (error) return fail(400, describeDbError(error));
    return ok(undefined, "차단했어요.");
  },

  /** 차단 해제. 가려져 있던 상대의 지난 메시지가 다시 보인다. */
  unblockUser: async (blockedId: string): Promise<ApiResponse> => {
    const userId = await requireUserId();
    if (!userId) return fail(401, "로그인이 필요합니다.");

    const { error } = await supabase
      .from("blocks")
      .delete()
      .eq("blocker_id", userId)
      .eq("blocked_id", blockedId);

    if (error) return fail(400, describeDbError(error));
    return ok(undefined, "차단을 해제했어요.");
  },

  /**
   * 내가 차단한 사람들 (settings/blocked.tsx)
   *
   * blocks_select 정책이 이미 내 것만 내려주지만, 운영자 계정(is_admin)에는
   * 남의 차단까지 보인다. 목록 화면에서 그게 섞이면 안 되므로 한 번 더 좁힌다.
   */
  getBlockedUsers: async (): Promise<ApiResponse<BlockedUser[]>> => {
    const userId = await requireUserId();
    if (!userId) return fail(401, "로그인이 필요합니다.");

    const { data, error } = await retryOnClockSkew<
      {
        blocked_id: string;
        blocked_name: string | null;
        blocked_dept: string | null;
        room_id: string | null;
        created_at: string;
      }[]
    >(() =>
      supabase
        .from("blocks")
        .select("blocked_id, blocked_name, blocked_dept, room_id, created_at")
        .eq("blocker_id", userId)
        .order("created_at", { ascending: false }),
    );

    if (error) return fail(500, describeDbError(error));

    return ok(
      (data ?? []).map((row) => ({
        id: row.blocked_id,
        name: row.blocked_name ?? "밋단 회원",
        dept: row.blocked_dept ?? undefined,
        roomId: row.room_id ?? undefined,
        blockedAt: toDateLabel(row.created_at),
      })),
    );
  },

  /**
   * 신고 접수.
   *
   * 같은 대상을 같은 방에서 두 번 신고하면 code 409 로 돌아온다
   * (reports_no_duplicate 유니크 인덱스). 화면은 "이미 접수된 신고예요"를
   * 보여주면 된다.
   *
   * ⚠️ roomId 는 chat_rooms.id 다. 매칭 id 를 넣으면 외래키에 걸린다.
   */
  submitReport: async (report: {
    targetType: ReportTargetType;
    /** USER 면 profiles.id, ROOM 이면 chat_rooms.id */
    targetId: string;
    reason: ReportReason;
    detail?: string;
    roomId?: string;
  }): Promise<ApiResponse> => {
    const userId = await requireUserId();
    if (!userId) return fail(401, "로그인이 필요합니다.");

    const { error } = await supabase.from("reports").insert({
      reporter_id: userId,
      target_type: report.targetType,
      target_id: report.targetId,
      // 제재 대상. 방 신고는 특정인을 지목하지 않는다.
      target_user_id: report.targetType === "USER" ? report.targetId : null,
      room_id: report.roomId ?? null,
      reason: report.reason,
      detail: report.detail?.trim() || null,
    });

    if (error) {
      if (error.code === "23505") {
        return fail(409, "같은 대상에 대한 신고가 이미 접수되어 처리 중이에요.");
      }
      return fail(400, describeDbError(error));
    }

    return ok(undefined, "신고가 접수되었어요.");
  },

  // ==========================================================
  // 알림
  //
  // 앱은 읽기만 한다. 알림을 만드는 건 전부 서버 트리거고(마이그레이션 012),
  // 읽음 표시는 RPC 로만 열려 있다 — notifications 에 직접 쓰는 길은 없다.
  // ==========================================================

  /**
   * 알림 목록 (최신순).
   *
   * 페이지네이션은 넣지 않았다. 한 사람에게 쌓이는 알림은 매칭 흐름 하나당
   * 몇 줄뿐이라 50줄이면 몇 주치가 들어온다. 그보다 오래된 알림을 다시
   * 들춰볼 이유가 생기면 그때 before 커서를 붙이면 된다
   * (getChatMessages 와 같은 모양으로).
   */
  getNotifications: async (
    limit = 50,
  ): Promise<ApiResponse<AppNotification[]>> => {
    const userId = await requireUserId();
    if (!userId) return fail(401, "로그인이 필요합니다.");

    const { data, error } = await retryOnClockSkew<NotificationRow[]>(() =>
      supabase
        .from("notifications")
        .select(NOTIFICATION_COLUMNS)
        .order("created_at", { ascending: false })
        .limit(limit)
        .returns<NotificationRow[]>(),
    );

    if (error) return fail(500, describeDbError(error));
    return ok((data ?? []).map(toNotification));
  },

  /**
   * 안 읽은 개수만. 홈 헤더의 빨간 점이 앱을 켜자마자 정확해야 하는데,
   * 그것 때문에 목록을 통째로 받아올 이유는 없다.
   * head: true 라 행은 오지 않고 count 만 온다.
   */
  getUnreadNotificationCount: async (): Promise<ApiResponse<number>> => {
    const userId = await requireUserId();
    if (!userId) return fail(401, "로그인이 필요합니다.");

    const { count, error } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null);

    if (error) return fail(500, describeDbError(error));
    return ok(count ?? 0);
  },

  /** 알림 하나를 읽음으로. 이미 읽은 알림이면 서버가 아무것도 하지 않는다. */
  markNotificationRead: async (
    notificationId: string,
  ): Promise<ApiResponse> => {
    const { error } = await supabase.rpc("mark_notification_read", {
      p_id: notificationId,
    });

    if (error) return fail(400, describeDbError(error));
    return ok();
  },

  /** 전부 읽음. 바뀐 줄 수를 돌려준다. */
  markAllNotificationsRead: async (): Promise<ApiResponse<number>> => {
    const { data, error } = await supabase.rpc("mark_all_notifications_read");

    if (error) return fail(400, describeDbError(error));
    return ok((data as number | null) ?? 0);
  },

  /**
   * 내 알림함을 실시간으로 듣는다. 해지 함수를 돌려준다
   * (subscribeToChatRoom 과 같은 모양이다 — useEffect 정리 함수로 바로 쓴다).
   *
   * 구독에도 RLS 가 걸려 남의 알림은 애초에 도착하지 않지만, 필터를 걸어
   * 두면 서버가 내 것만 골라 보내므로 오가는 양이 줄어든다.
   *
   * INSERT 만 듣는다. 읽음 표시(UPDATE)는 이 기기가 스스로 한 일이라
   * 되돌려받을 필요가 없다.
   */
  subscribeToNotifications: (
    userId: string,
    onNotification: (item: AppNotification) => void,
  ): (() => void) => {
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => onNotification(toNotification(payload.new as NotificationRow)),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },

  /**
   * 내가 꺼 둔 알림 종류 (설정 화면).
   *
   * '켠 것'이 아니라 '끈 것'이 저장된다. 목록에 없으면 받는다는 뜻이라
   * 처음 들어온 사람은 빈 배열을 받는다 — 그게 '전부 켜짐'이다.
   */
  getNotificationMutes: async (): Promise<ApiResponse<NotificationKind[]>> => {
    const userId = await requireUserId();
    if (!userId) return fail(401, "로그인이 필요합니다.");

    const { data, error } = await retryOnClockSkew<{ kind: NotificationKind }[]>(
      () => supabase.from("notification_mutes").select("kind"),
    );

    if (error) return fail(500, describeDbError(error));
    return ok((data ?? []).map((row) => row.kind));
  },

  /**
   * 알림 종류 켜기 / 끄기.
   *
   * 여러 종류를 한 번에 보낸다. 화면의 스위치 하나가 종류 여럿을 묶고 있어서
   * (예: '매칭 결과' = 성사 + 거절 + 취소) 하나씩 부르면 왕복이 늘어난다.
   */
  setNotificationMuted: async (
    kinds: NotificationKind[],
    muted: boolean,
  ): Promise<ApiResponse> => {
    const { error } = await supabase.rpc("set_notification_mutes", {
      p_kinds: kinds,
      p_muted: muted,
    });

    if (error) return fail(400, describeDbError(error));
    return ok();
  },

  // ==========================================================
  // 푸시 알림 기기 토큰
  //
  // 토큰을 얻는 일(권한·발급)은 lib/push.ts 가 하고, 서버에 남기는 일만
  // 여기서 한다. 알림 자체는 서버가 만들어 보내므로 앱이 할 일은
  // "이 기기로 보내주세요" 한 줄을 등록해 두는 것뿐이다.
  // ==========================================================

  /**
   * 기기 등록. 앱을 켤 때마다 부른다 — 토큰은 재설치·업데이트로 바뀌고,
   * 같은 기기를 다른 계정이 쓰기 시작했을 수도 있다(그때는 주인만 바뀐다).
   */
  savePushToken: async (
    token: string,
    platform: "ios" | "android",
  ): Promise<ApiResponse> => {
    const { error } = await supabase.rpc("save_push_token", {
      p_token: token,
      p_platform: platform,
    });

    if (error) {
      // 푸시를 못 켰다고 앱을 막지 않는다. 원인은 콘솔에만 남긴다.
      console.error("[푸시] 토큰 등록 실패", error);
      return fail(400, describeDbError(error));
    }
    return ok();
  },

  /** 기기 해제. 로그아웃할 때 부른다 — 안 하면 다음 사용자에게 내 알림이 간다. */
  removePushToken: async (token: string): Promise<ApiResponse> => {
    const { error } = await supabase.rpc("delete_push_token", {
      p_token: token,
    });

    if (error) {
      console.error("[푸시] 토큰 해제 실패", error);
      return fail(400, describeDbError(error));
    }
    return ok();
  },

  /** 로그아웃. 세션이 사라지면 _layout.tsx 가 알아서 로그인 화면으로 보낸다. */
  logout: async (): Promise<ApiResponse> => {
    /*
     * 세션을 지우기 전에 이 기기의 푸시 등록을 먼저 뗀다.
     * 순서가 중요하다 — signOut 이 먼저면 RPC 가 인증 없이 나가서 아무것도
     * 지우지 못하고, 그 기기로는 이전 사용자의 알림이 계속 날아간다.
     * (실패해도 로그아웃은 계속 진행한다)
     */
    const pushToken = getRegisteredPushToken();
    if (pushToken) {
      await API.removePushToken(pushToken);
      clearRegisteredPushToken();
    }

    const { error } = await supabase.auth.signOut();
    if (error) {
      // 서버 호출이 실패해도 기기의 세션은 이미 지워진다. 계속 진행한다.
      console.error("[로그아웃]", error);
    }
    return ok();
  },
};
