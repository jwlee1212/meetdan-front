// 파일: utils/fortune.ts
// 홈 피드에 끼워 넣는 "오늘의 연애 운세".
//
// 서버가 없다. 운세는 (사람, 날짜) 한 쌍만 정해지면 나머지가 전부 따라 나오는
// 값이라 클라이언트에서 계산하는 편이 훨씬 낫다 — 통신도, 저장도, 매일 자정에
// 전원분을 미리 만들어두는 배치도 필요 없다.
//
// 대신 두 가지는 반드시 지켜야 한다.
//   1) 같은 사람이 같은 날 몇 번을 다시 열어도 같은 운세여야 한다.
//      (새로고침할 때마다 점수가 바뀌면 그건 운세가 아니라 난수 표시기다)
//   2) 사람마다 달라야 한다.
// 그래서 Math.random 이 아니라 "아이디 + 날짜"를 해시한 값을 씨앗으로 쓴다.

/** 점수 구간. 문구 톤과 뱃지 색이 여기서 갈린다. */
export type FortuneTier = "great" | "good" | "soso";

export interface DailyFortune {
  /** 연애운 지수 55~99. 0점부터 뽑지 않는 건 아래 SCORE_MIN 주석 참고 */
  score: number;
  tier: FortuneTier;
  /** 뱃지에 들어가는 두세 글자 요약 */
  headline: string;
  /** 본문 한두 문장 */
  message: string;
  luckyTime: string;
  luckyMbti: string;
  luckyPlace: string;
  /** "8월 23일 (일)" */
  dateLabel: string;
}

/**
 * FNV-1a 32비트. 암호용이 아니라 "글자 몇 개를 골고루 흩어진 숫자로" 바꾸는 용도다.
 * 짧은 문자열에서도 한 글자만 달라지면 결과가 전혀 달라진다는 성질만 있으면 된다.
 */
function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 같은 씨앗에서 여러 값을 뽑을 때는 항목마다 다른 소금을 섞는다.
 * 안 그러면 점수가 높은 사람은 늘 같은 시간대가 나오는 식으로 값들이 붙어 다닌다.
 */
function pick<T>(list: readonly T[], seed: string, salt: string): T {
  return list[hash(`${seed}#${salt}`) % list.length];
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 날짜 씨앗. 시:분을 떼야 하루 종일 같은 운세가 나온다. */
function dateSeed(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * 점수 하한을 55로 둔다.
 *
 * 진짜 균등분포로 뽑으면 열 명 중 한 명은 아침에 앱을 열자마자 "12점"을 본다.
 * 초기 서비스에서 그건 그냥 나갈 이유 하나를 더 주는 것이다. 낮은 쪽도 "오늘은
 * 쉬어가는 날" 정도로 읽히게 폭을 좁혔다.
 */
const SCORE_MIN = 55;
const SCORE_RANGE = 45; // 55 ~ 99

const MESSAGES: Record<FortuneTier, readonly string[]> = {
  great: [
    "오늘은 먼저 말을 거는 쪽이 이겨요. 눈이 마주쳤다면 그건 신호예요.",
    "대화가 술술 풀리는 날이에요. 미뤄둔 말이 있다면 오늘 꺼내보세요.",
    "웃는 얼굴이 평소보다 세 배쯤 잘 통해요. 사진 한 장 새로 올려볼까요?",
    "우연이 겹치는 날이에요. 오늘 마주친 사람, 그냥 지나칠 인연이 아닐지도.",
    "망설이던 신청 버튼을 눌러도 좋은 날이에요. 거절당할 확률이 가장 낮아요.",
  ],
  good: [
    "무리하지 않아도 분위기가 좋아요. 가볍게 안부부터 물어보세요.",
    "상대도 답장을 고민하는 중이에요. 조금만 기다려주면 좋은 소식이 와요.",
    "첫인상보다 두 번째가 좋은 날이에요. 서두르지 않아도 괜찮아요.",
    "말수보다 리액션이 통하는 날. 잘 들어주는 것만으로 반은 성공이에요.",
    "새로 만난 사람보다 이미 아는 사람 쪽에 기회가 있어요.",
  ],
  soso: [
    "오늘은 나를 챙기는 날. 무리한 약속은 다음으로 미뤄도 괜찮아요.",
    "지금은 씨앗을 뿌리는 시기예요. 프로필을 다듬어두면 곧 결과가 따라와요.",
    "연락이 늦다고 마음이 식은 건 아니에요. 조급해하지 않아도 돼요.",
    "가벼운 농담이 오해가 될 수 있는 날. 보내기 전에 한 번만 더 읽어보세요.",
    "오늘 안 풀린 건 내일 풀려요. 대신 하고 싶던 말은 적어두기.",
  ],
};

const HEADLINES: Record<FortuneTier, string> = {
  great: "최고의 날",
  good: "순항 중",
  soso: "숨 고르기",
};

const LUCKY_TIMES = [
  "아침 첫 수업 전",
  "점심 무렵",
  "오후 3시쯤",
  "수업 끝나고 바로",
  "해 질 무렵",
  "저녁 7시 이후",
  "잠들기 직전",
] as const;

const MBTI_TYPES = [
  "ISTJ", "ISFJ", "INFJ", "INTJ",
  "ISTP", "ISFP", "INFP", "INTP",
  "ESTP", "ESFP", "ENFP", "ENTP",
  "ESTJ", "ESFJ", "ENFJ", "ENTJ",
] as const;

/**
 * 행운의 장소는 캠퍼스별로 다르게 준다.
 * "죽전역"이라고 적혀 있으면 천안 캠퍼스 학생에겐 남의 이야기가 된다.
 */
const LUCKY_PLACES: Record<"죽전" | "천안", readonly string[]> = {
  // 셋째 칸에 한 줄로 들어가는 값이라 여섯 글자를 넘기지 않는다
  죽전: [
    "죽전역 근처",
    "보정동 카페",
    "정문 앞 카페",
    "중앙광장",
    "미금역 근처",
    "학관 편의점",
  ],
  천안: [
    "천안역 근처",
    "신부동 골목",
    "두정동 카페",
    "야우리 근처",
    "정문 앞 카페",
    "학생회관 앞",
  ],
};

/** 캠퍼스를 모를 때(로그인 직후 잠깐) 쓰는 중립 장소 */
const NEUTRAL_PLACES = [
  "학교 앞 카페",
  "수업 가는 길",
  "도서관 앞",
  "학식 줄",
] as const;

interface FortuneInput {
  /** 사람을 가르는 값. 보통 currentUser.id. 없으면 모두 같은 운세가 된다 */
  userId?: string | null;
  campus?: "죽전" | "천안" | null;
  /** 테스트에서 날짜를 고정하려고 열어둔 자리 */
  now?: Date;
}

/** 오늘의 연애 운세 한 벌. 같은 사람·같은 날이면 항상 같은 값이 나온다. */
export function getDailyFortune({
  userId,
  campus,
  now = new Date(),
}: FortuneInput): DailyFortune {
  const seed = `${userId ?? "guest"}@${dateSeed(now)}`;

  const score = SCORE_MIN + (hash(`${seed}#score`) % SCORE_RANGE);
  const tier: FortuneTier = score >= 85 ? "great" : score >= 70 ? "good" : "soso";

  const places = campus ? LUCKY_PLACES[campus] : NEUTRAL_PLACES;

  return {
    score,
    tier,
    headline: HEADLINES[tier],
    message: pick(MESSAGES[tier], seed, "message"),
    luckyTime: pick(LUCKY_TIMES, seed, "time"),
    luckyMbti: pick(MBTI_TYPES, seed, "mbti"),
    luckyPlace: pick(places, seed, "place"),
    dateLabel: `${now.getMonth() + 1}월 ${now.getDate()}일 (${WEEKDAYS[now.getDay()]})`,
  };
}
