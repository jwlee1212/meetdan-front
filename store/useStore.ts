// 파일: store/useStore.ts
import { create } from "zustand";

// 1. Team 인터페이스
export interface Team {
  /** teams.id (uuid). 게시판 목업 데이터만 아직 "1", "2" 같은 짧은 문자열을 쓴다. */
  id: string;
  title: string;
  campus: "죽전" | "천안";
  dept: string;
  gender: "M" | "F";
  /** MATCHED = 매칭이 성사된 팀. 더 이상 게시판에 노출되지 않고 신청도 받지 않는다. */
  status: "RECRUITING" | "ACTIVE" | "FULL" | "READY" | "MATCHED";
  content: string;
  count: number;
  currentCount: number;
  /**
   * 팀원 출생연도로 서버가 계산한 평균 나이(세는나이).
   * 팀원 중 출생연도를 등록한 사람이 없으면 null 이다.
   */
  age: number | null;
  timestamp: string;
  tags: string[];
  members: TeamMember[];
  inviteCode?: string;
  /**
   * 내가 이 팀의 팀장인가. 서버에서 온 팀에만 채워진다.
   * 수정·삭제(팀장)와 나가기(팀원)를 가르는 기준이다.
   */
  isOwner?: boolean;
}

/** 팀원 개개인의 프로필 카드에 필요한 정보. name/role 외엔 없을 수 있다(목업 데이터 한계). */
export interface TeamMember {
  name: string;
  role: "LEADER" | "MEMBER" | string;
  /** assets/images/profile_avatars 인덱스. 없으면 0번으로 대체 */
  avatarIdx?: number;
  dept?: string;
  mbti?: string;
  bio?: string;
}

// 2. 매칭 정보 인터페이스
/** 양 팀이 합의한 만남 약속. 채팅방에서 직접 입력받는다(자동 감지 아님). */
export interface ConfirmedPlan {
  /** "YYYY-MM-DD" */
  date: string;
  /** "HH:mm" (24시간) */
  time: string;
  /** 자유 텍스트. 예: "죽전역 근처" */
  place: string;
}

export interface Match {
  /** matches.id (uuid). 채팅방 경로(/chat/[id])도 이 값을 쓴다. */
  id: string;
  myTeamId: string;
  partnerTeamId: string;
  partnerTeamName: string;
  startedAt: string;
  /** chat_rooms.id. 매칭이 성사되면 트리거가 만든다. */
  roomId?: string;
  /** 선택 사항. 없어도 채팅·매칭은 그대로 굴러간다. */
  confirmedPlan?: ConfirmedPlan;
}

// 3. 신청서 데이터 (보낸 것, 받은 것 공통 사용)
/**
 * matches 한 줄을 '보는 사람 기준'으로 뒤집어 놓은 모양.
 *
 * 서버에는 from_team_id / to_team_id 만 있고 '보낸 것'과 '받은 것'은
 * 내가 어느 쪽 팀에 속했느냐로 갈린다. 화면은 늘 '상대 팀'을 그리므로
 * 그 계산은 api/client.ts 가 한 번만 하고, 여기서는 결과만 들고 있는다.
 */
export interface MatchRequest {
  /** matches.id (uuid) */
  id: string;
  status: "WAITING" | "ACCEPTED" | "REJECTED";
  /** 신청이 들어온 시각을 "방금 전"처럼 다듬은 값 */
  timestamp: string;
  /** 내가 받은 신청인가(true) 보낸 신청인가(false) */
  received: boolean;
  /** 이 신청에 걸린 내 팀 */
  myTeamId: string;
  /** 상대 팀. 받은 신청이면 보낸 팀, 보낸 신청이면 받는 팀 */
  partnerTeam: Team;
}

// 4. 신고 / 차단
export type ReportReason = "ABUSE" | "SEXUAL" | "SPAM" | "FRAUD" | "NO_SHOW" | "ETC";

/** 신고 대상. 사람 한 명일 수도 있고, 채팅방 전체일 수도 있다. */
export type ReportTargetType = "USER" | "ROOM";

export interface Report {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  targetName: string;
  reason: ReportReason;
  detail: string;
  /** 어느 채팅방에서 신고했는지 (운영자가 대화를 열어볼 수 있게) */
  roomId?: string;
  createdAt: string;
}

export interface BlockedUser {
  id: string;
  name: string;
  dept?: string;
  /** 어느 방에서 차단했는지 (차단 목록에서 맥락을 보여주려고) */
  roomId?: string;
  blockedAt: string;
}

// 5. 로그인한 나 자신
/**
 * 로그인/재시작 시 서버에서 받아오는 내 정보. Supabase profiles 한 줄과 1:1이다.
 * 화면 곳곳(프로필, 팀 생성, 초대 코드 참여)이 여기 한 곳만 보게 한다.
 */
export interface CurrentUser {
  /** profiles.id = auth.users.id (uuid) */
  id: string;
  /** 로그인 아이디 (profiles.login_id). 가입 후 변경 불가 */
  loginId: string;
  /** 실명. 가입 후 변경 불가 */
  name: string;
  email: string;
  /** 마이 탭에서 바꾸는 별명. 설정 안 했으면 빈 문자열 */
  nickname: string;
  /** nickname 이 비었으면 name. 화면에 이름을 뿌릴 땐 이걸 쓴다 */
  displayName: string;
  dept: string;
  gender: "M" | "F";
  campus: "죽전" | "천안";
  /**
   * 가입 시 받는 출생연도. 팀 평균 나이는 서버가 이 값으로 계산한다.
   * 마이그레이션 006 이전에 가입한 계정은 아직 비어 있다(null).
   */
  birthYear: number | null;
  /** birthYear 로 환산한 세는나이. 출생연도가 없으면 null */
  age: number | null;
  bio: string;
  mbti: string;
  /** assets/images/profile_avatars 인덱스 */
  avatarIdx: number;
}

interface AppState {
  currentUser: CurrentUser | null;
  posts: Team[];
  myTeams: Team[];
  /**
   * 매칭이 성사되어 게시판에서 내려간 팀들.
   * 활동 내역·채팅방에서 상대 팀 이름과 학과를 계속 찾을 수 있게 보관한다.
   */
  matchedTeams: Team[];
  sentRequests: MatchRequest[];
  receivedRequests: MatchRequest[];
  matches: Match[];
  reports: Report[];
  blockedUsers: BlockedUser[];

  setCurrentUser: (user: CurrentUser) => void;
  /** 로그아웃 시 호출. 다음 계정에 이전 유저 정보가 새지 않게 한다. */
  clearCurrentUser: () => void;

  setPosts: (posts: Team[]) => void;
  addPost: (post: Team) => void;
  /**
   * 서버(teams/team_members)에서 읽어온 내 팀 목록으로 갈아끼운다.
   * 팀 생성·참여·삭제는 전부 서버가 처리하므로, 화면은 쓰기 뒤에 다시 읽어
   * 이걸 부른다. 클라이언트가 따로 계산하는 값은 없다.
   */
  setMyTeams: (teams: Team[]) => void;
  updateTeam: (id: string, updates: Partial<Team>) => void;

  /**
   * 서버(matches)에서 읽어온 신청 목록으로 갈아끼운다.
   *
   * 신청·수락·거절은 전부 서버가 처리한다. 수락 한 번에 채팅방이 생기고,
   * 두 팀이 MATCHED 로 내려가고, 두 팀에 걸려 있던 다른 신청이 자동
   * 거절되는 것까지 트리거 한 벌이 한 트랜잭션에서 끝낸다.
   * 화면이 그 결과를 흉내 내면 반드시 서버와 어긋나므로, 쓰기 뒤에는
   * 다시 읽어서 이걸 부른다.
   */
  setRequests: (requests: {
    received: MatchRequest[];
    sent: MatchRequest[];
  }) => void;
  /** 성사된 매칭 목록. 상대 팀은 matchedTeams 에 같이 넣어둔다(채팅 헤더가 읽는다). */
  setMatches: (matches: Match[], partnerTeams: Team[]) => void;

  /**
   * 약속 확정/수정. 채팅방 id로 매칭 기록을 못 찾으면(예전 경로로 들어온 방)
   * fallbackName으로 최소한의 기록을 만들어 둔다. 그래야 활동 탭에서도 보인다.
   */
  setConfirmedPlan: (
    matchId: string,
    plan: ConfirmedPlan,
    fallbackName?: string,
  ) => void;
  clearConfirmedPlan: (matchId: string) => void;

  /** 신고 접수. 같은 대상을 중복 신고하면 false를 돌려준다. */
  submitReport: (report: Omit<Report, "id" | "createdAt">) => boolean;
  blockUser: (user: Omit<BlockedUser, "blockedAt">) => void;
  unblockUser: (userId: string) => void;
  isBlocked: (userId: string) => boolean;
}

const formatDate = (d = new Date()) =>
  `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;

export const useStore = create<AppState>((set, get) => ({
  // 0. 로그인 전에는 비어있음. 로그인 또는 앱 재시작 복원 시 채워진다.
  currentUser: null,

  // 게시판도 서버가 갖고 있다. 홈 탭이 화면에 들어올 때마다
  // API.getPosts() 로 채운다(setPosts). 목업을 남겨두면 로그인 직후
  // 실제로는 없는 팀이 잠깐 스쳐 보이고, 눌러도 서버에 없는 id 라 아무것도 안 된다.
  posts: [],

  // 내 팀은 서버가 갖고 있다. my_team.tsx 가 화면에 들어올 때마다
  // API.getMyTeams() 로 채운다(setMyTeams). 목업을 남겨두면 로그인 직후
  // 남의 팀이 잠깐 스쳐 보인다.
  myTeams: [],

  // 신청도 서버가 갖고 있다. 활동 탭(history.tsx)이 화면에 들어올 때마다
  // API.getMatchRequests() 로 채운다(setRequests). 목업을 남겨두면 서버에
  // 없는 팀 id 를 들고 상세 화면으로 들어가 아무것도 못 하는 줄이 생긴다.
  sentRequests: [],
  receivedRequests: [],

  // 매칭 성사 목록과 그 상대 팀. 둘 다 setMatches 가 함께 채운다.
  matchedTeams: [],
  matches: [],
  reports: [],
  blockedUsers: [],

  setCurrentUser: (user) => set({ currentUser: user }),

  // 로그아웃하면 내 것이던 목록도 함께 비운다. 다음 계정이 들어와
  // 화면이 다시 읽기 전까지 이전 사람의 팀·신청이 잠깐 보이면 안 된다.
  // (어차피 앱을 껐다 켜면 전부 사라지는 값들이다 — 저장하지 않는다)
  clearCurrentUser: () =>
    set({
      currentUser: null,
      posts: [],
      myTeams: [],
      matchedTeams: [],
      sentRequests: [],
      receivedRequests: [],
      matches: [],
      reports: [],
      blockedUsers: [],
    }),

  // ... (기존 액션들 동일) ...
  setPosts: (newPosts) => set({ posts: newPosts }),
  addPost: (newPost) => set((state) => ({ posts: [newPost, ...state.posts] })),
  setMyTeams: (teams) => set({ myTeams: teams }),
  updateTeam: (id, updates) =>
    set((state) => ({
      myTeams: state.myTeams.map((t) =>
        t.id === id ? { ...t, ...updates } : t,
      ),
      posts: state.posts.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    })),

  setRequests: ({ received, sent }) =>
    set({ receivedRequests: received, sentRequests: sent }),

  setMatches: (matches, partnerTeams) =>
    set({ matches, matchedTeams: partnerTeams }),

  setConfirmedPlan: (matchId, plan, fallbackName) =>
    set((state) => {
      const exists = state.matches.some((m) => m.id === matchId);
      if (exists) {
        return {
          matches: state.matches.map((m) =>
            m.id === matchId ? { ...m, confirmedPlan: plan } : m,
          ),
        };
      }
      const placeholder: Match = {
        id: matchId,
        // 어느 두 팀의 매칭인지 모르는 채로 만든 자리표시자. 팀 id 는 비워 둔다.
        myTeamId: "",
        partnerTeamId: "",
        partnerTeamName: fallbackName ?? "매칭된 팀",
        startedAt: formatDate(),
        confirmedPlan: plan,
      };
      return { matches: [placeholder, ...state.matches] };
    }),

  clearConfirmedPlan: (matchId) =>
    set((state) => ({
      matches: state.matches.map((m) =>
        m.id === matchId ? { ...m, confirmedPlan: undefined } : m,
      ),
    })),

  // ── 신고 / 차단 ────────────────────────────────────────
  submitReport: (report) => {
    // 같은 방에서 같은 대상을 또 신고하는 건 막는다. (운영 쪽 중복 접수 방지)
    const already = get().reports.some(
      (r) =>
        r.targetType === report.targetType &&
        r.targetId === report.targetId &&
        r.roomId === report.roomId,
    );
    if (already) return false;

    const newReport: Report = {
      ...report,
      id: `report_${Date.now()}`,
      createdAt: formatDate(),
    };
    set((state) => ({ reports: [newReport, ...state.reports] }));
    return true;
  },

  blockUser: (user) =>
    set((state) => {
      if (state.blockedUsers.some((b) => b.id === user.id)) return state;
      return {
        blockedUsers: [
          { ...user, blockedAt: formatDate() },
          ...state.blockedUsers,
        ],
      };
    }),

  unblockUser: (userId) =>
    set((state) => ({
      blockedUsers: state.blockedUsers.filter((b) => b.id !== userId),
    })),

  isBlocked: (userId) => get().blockedUsers.some((b) => b.id === userId),
}));

/** 신고 사유 라벨. 시트와 차단 목록이 같은 문구를 쓰도록 한곳에 둔다. */
export const REPORT_REASONS: {
  value: ReportReason;
  label: string;
  desc: string;
}[] = [
  { value: "ABUSE", label: "욕설·비방", desc: "모욕적인 언행이나 혐오 표현" },
  { value: "SEXUAL", label: "성희롱·불쾌한 대화", desc: "성적인 농담이나 요구" },
  { value: "SPAM", label: "광고·홍보", desc: "외부 링크나 상업적 목적의 대화" },
  { value: "FRAUD", label: "사칭·사기", desc: "타인 사칭, 금전 요구" },
  { value: "NO_SHOW", label: "약속 불이행", desc: "노쇼하거나 연락이 끊김" },
  { value: "ETC", label: "기타", desc: "위에 없는 다른 문제" },
];
