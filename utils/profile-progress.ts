// 파일: utils/profile-progress.ts
// "프로필 설정 진행도" 계산. 홈 피드의 안내 줄이 쓴다.
import type { CurrentUser } from "@/store/useStore";

/** 진행도에 세는 항목 하나 */
export interface ProfileStep {
  key: "nickname" | "bio" | "mbti";
  /** 뱃지에 그대로 들어가는 이름 */
  label: string;
  done: boolean;
}

export interface ProfileProgress {
  steps: ProfileStep[];
  /** 채운 개수 */
  done: number;
  /** 전체 개수 */
  total: number;
  /** 0~1 */
  ratio: number;
  /** 아직 안 채운 항목들 */
  missing: ProfileStep[];
  isComplete: boolean;
  /** 목록 줄 제목 */
  title: string;
  /** 목록 줄 본문 — 무엇을 하면 뭐가 좋아지는지 한 문장 */
  message: string;
}

/**
 * 진행도에 넣는 항목은 "마이 탭에서 지금 바로 바꿀 수 있는 것"만이다.
 *
 * 이름·학과·캠퍼스는 학교 인증으로 들어와 본인이 못 바꾸므로 넣으면 영영
 * 100%가 안 되거나, 반대로 아무것도 안 했는데 이미 60%인 것처럼 보인다.
 * 프로필 캐릭터도 뺐다 — avatar_idx 기본값이 0번이라 "0번을 고른 사람"과
 * "아직 안 고른 사람"을 서버 값만 보고는 구분할 수 없다.
 */
const STEP_LABELS: Record<ProfileStep["key"], string> = {
  nickname: "닉네임",
  bio: "한 줄 소개",
  mbti: "MBTI",
};

const filled = (value?: string | null) => !!value && value.trim().length > 0;

export function getProfileProgress(
  user: CurrentUser | null,
): ProfileProgress | null {
  // 아직 내 정보가 안 왔으면 진행도를 그리지 않는다. 잠깐 "0/3"이 스쳤다가
  // 곧바로 "3/3"으로 바뀌면 다 해둔 사람에게 안 해도 될 잔소리를 한 셈이 된다.
  if (!user) return null;

  const steps: ProfileStep[] = [
    { key: "nickname", label: STEP_LABELS.nickname, done: filled(user.nickname) },
    { key: "bio", label: STEP_LABELS.bio, done: filled(user.bio) },
    { key: "mbti", label: STEP_LABELS.mbti, done: filled(user.mbti) },
  ];

  const missing = steps.filter((s) => !s.done);
  const done = steps.length - missing.length;
  const total = steps.length;

  return {
    steps,
    done,
    total,
    ratio: done / total,
    missing,
    isComplete: missing.length === 0,
    title: buildTitle(missing),
    message: buildMessage(missing),
  };
}

/** 남은 개수에 따라 말투를 바꾼다. 하나 남았을 땐 그 항목을 콕 집어준다. */
function buildTitle(missing: ProfileStep[]): string {
  if (missing.length === 0) return "프로필을 다 채웠어요";
  if (missing.length === 1) return `${missing[0].label}만 추가하면 완성이에요`;
  return "프로필 설정을 완료해보세요";
}

function buildMessage(missing: ProfileStep[]): string {
  if (missing.length === 0) {
    return "상대 팀이 우리 팀을 볼 때 내 소개가 함께 보여요.";
  }
  // 하나만 남았을 땐 제목이 이미 그 항목 이름을 부르고 있다. 본문까지
  // 같은 단어를 반복하지 않고 왜 채워야 하는지만 말한다.
  if (missing.length === 1) return "프로필 설정을 완료하면 매칭률이 올라가요!";

  const names = missing.map((s) => s.label).join(" · ");
  return `${names}${objectParticle(names)} 채우면 매칭률이 올라가요!`;
}

/**
 * 을/를. "닉네임을"과 "한 줄 소개를"이 남은 항목에 따라 바뀌므로 문장을
 * 미리 못 적어둔다.
 *
 * 한글 음절은 (코드 - 0xAC00) % 28 이 0이 아니면 받침이 있다. 한글이 아닌
 * 마지막 글자(=MBTI)는 "엠비티아이"로 읽혀 받침이 없으므로 "를"로 둔다.
 */
function objectParticle(word: string): "을" | "를" {
  const code = word.charCodeAt(word.length - 1);
  const isHangulSyllable = code >= 0xac00 && code <= 0xd7a3;
  if (!isHangulSyllable) return "를";
  return (code - 0xac00) % 28 === 0 ? "를" : "을";
}
