// 파일: utils/profanity.ts
//
// 사람이 글을 적어 넣는 모든 자리에서 돌리는 비속어 필터.
// 목록은 여기 하드코딩하고, 화면에서는 hasProfanity() / assertClean() 만 쓰면 된다.
//
// 단어가 100개쯤 되면 매 전송마다 배열을 순회하는 대신 정규식 하나로 합쳐두는 게
// 훨씬 빠르다. 아래 정규식은 모듈이 처음 로드될 때 딱 한 번만 만들어진다.
//
// ── 출처 ────────────────────────────────────────────────────────────
// 아래 목록은 LDNOOBW "List of Dirty, Naughty, Obscene, and Otherwise
// Bad Words"의 한국어 목록(ko, 72개)을 가져와 수정한 것이다.
//   https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words
//   Licensed under CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/
// CC BY 4.0은 출처 표기 의무가 있으므로 앱의 오픈소스 고지 화면에도 넣어야 한다.
// 원본에서 오탐이 잦은 항목을 빼고(EXCLUDED 주석 참고) 일부 표현을 추가했다.
// ────────────────────────────────────────────────────────────────────

import { Alert } from "react-native";

/* ------------------------------------------------------------------ */
/* 1. 목록 (여기만 채우면 된다)                                          */
/* ------------------------------------------------------------------ */

/**
 * 차단할 단어 목록.
 *
 * - 한글이 섞인 단어는 문장 어디에 있든(부분 일치) 걸린다.
 * - 영문/숫자만으로 된 단어는 앞뒤가 끊기는 자리에서만 걸린다.
 *   ("ass"를 넣어도 "classic"은 걸리지 않는다)
 * - 숫자를 섞은 변형(십팔 → 18 같은)은 자동으로 잡지 못하니 별도 항목으로 넣어야 한다.
 * - 대소문자는 신경 쓰지 않아도 된다. 전부 소문자로 맞춰서 비교한다.
 */
export const PROFANITY_WORDS: string[] = [
  // ── LDNOOBW ko 원본에서 그대로 가져온 항목 (56개) ──
  "강간",
  "개새끼",
  "개자식",
  "개좆",
  "개차반",
  "계집년",
  "근친",
  "니기미",
  "뒤질래",
  "딸딸이",
  "때씹",
  "또라이",
  "뙤놈",
  "로리타",
  "몰카",
  "미친새끼",
  "바바리맨",
  "변태",
  "병신",
  "빠구리",
  "사까시",
  "섹스",
  "스와핑",
  "쌍놈",
  "씨발",
  "씨발놈",
  "씨팔",
  "씹물",
  "씹빨",
  "씹새끼",
  "씹알",
  "씹창",
  "씹팔",
  "암캐",
  "야동",
  "야애니",
  "엄창",
  "염병",
  "옘병",
  "육갑",
  "은꼴",
  "잡년",
  "종간나",
  "좆",
  "좆만",
  "죽일년",
  "쥐좆",
  "직촬",
  "짱깨",
  "쪽바리",
  "창녀",
  "포르노",
  "하드코어",
  "화냥년",
  "후레아들",
  "희쭈그리",

  // ── 추가 (원본에 없던 표현 / 뺀 단어를 메우는 합성어 · 초성) ──
  "시발",
  "시발놈",
  "시팔",
  "지랄",
  "존나",
  "미친놈",
  "미친년",
  "씨발년",
  "ㅅㅂ",
  "ㅆㅂ",
  "ㅂㅅ",
  "ㅄ",
  "ㅈㄹ",

  // ── EXCLUDED: 원본에 있지만 뺀 항목 (16개) ──
  // 일상어와 겹치거나, 공백을 지우고 비교하는 특성상 멀쩡한 문장을 막는다.
  // 되살리려면 반드시 PROFANITY_ALLOWLIST를 함께 손봐야 한다.
  //
  //   보지  → "영화 보지 마", "보지 않았어"
  //   자지  → "자지 마", "자지 않고"
  //   미친  → 일상 감탄사("미친 재밌다") + "이미 친해졌어"
  //   씹    → 씹다/씹어  (합성어는 위에 그대로 살려뒀다)
  //   망가  → 망가지다
  //   고자  → 고자질, "참고 자료", "그리고 자기소개"
  //   거유  → "이거 유명한 곳이야"
  //   유모  → 유모차, "이유 모르겠어"
  //   노모  → 老母
  //   에로  → "학교에 로그인", "여기에 로봇"
  //   자위  → "혼자 위험해", 자위대
  //   애자  → "그 애 자체가"
  //   야사  → "이야 사진 잘 나왔다"
  //   호로  → "번호로 연락할게"   ← 이 앱에서 특히 잦다
  //   후장  → "이후 장소 정하자"  ← 이 앱에서 특히 잦다
  //   불알  → "불 알림 꺼놨어요"
];

/**
 * 오탐이 확인된 표현. 검사 전에 이 표현들을 먼저 지운다.
 *
 * 우회를 막으려고 공백·특수문자를 걷어내고 비교하다 보니, 멀쩡한 문장이
 * 붙으면서 금칙어가 되는 경우가 생긴다. (예: "무시 발언" → "무시발언")
 * 그런 조합이 발견될 때마다 여기에 추가한다.
 */
export const PROFANITY_ALLOWLIST: string[] = [
  // "시(時) + 발~" 조합. 약속 시간 얘기가 잦은 앱이라 실제로 부딪힌다.
  "무시 발언",
  "시 발표",
  "시 발권",
  "시 발송",
  "시 발생",
  "시발점",
];

/** 전송이 막혔을 때 띄우는 문구. 어떤 단어가 걸렸는지는 알려주지 않는다. */
export const PROFANITY_ALERT_TITLE = "부적절한 표현이 포함되어 있어요";
export const PROFANITY_ALERT_MESSAGE =
  "메시지를 다시 확인해주세요. 서로 기분 좋게 대화해요.";

/**
 * 채팅이 아닌 입력칸(제목·소개·닉네임 등)에서 쓰는 문구.
 *
 * 한 화면에 칸이 여럿이라 어느 칸이 걸렸는지는 알려줘야 고칠 수 있다.
 * 다만 '어떤 단어'인지는 여전히 감춘다 — 알려주면 우회를 학습시키는 셈이다.
 *
 * 라벨 뒤에 조사를 붙이지 않고 따옴표로 감싼 이유: 받침에 따라 을/를·이/가가
 * 갈리는데 라벨은 화면마다 다르다. 따옴표면 어떤 말이 와도 문장이 성립한다.
 */
export const profanityFieldMessage = (label: string) =>
  `'${label}'에 쓸 수 없는 표현이 있어요. 다시 확인해주세요.`;

/* ------------------------------------------------------------------ */
/* 2. 내부 구현 (건드릴 일 없음)                                         */
/* ------------------------------------------------------------------ */

/** 단어 사이에 끼워 넣어 필터를 피하는 데 쓰이는 문자들 */
// 마지막 네 개는 눈에 보이지 않는 문자들(zero-width space 등)
const FILLER_RE =
  /[\s._\-*^~!?,'"`|/\\+=@#$%&()[\]{}<>:;​‌‍⁠]/g;

const escapeRe = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 영문·숫자로만 이루어진 단어인지 (한글이 섞이면 false) */
const isAsciiWord = (word: string) => /^[a-z0-9]+$/i.test(word);

/** 긴 단어가 먼저 걸려야 findProfanity가 더 정확한 단어를 돌려준다 */
const byLengthDesc = (a: string, b: string) => b.length - a.length;

const prepare = (words: string[]) =>
  Array.from(
    new Set(
      words.map((w) => w.trim().toLowerCase()).filter((w) => w.length > 0),
    ),
  ).sort(byLengthDesc);

const ALL_WORDS = prepare(PROFANITY_WORDS);
const ASCII_WORDS = ALL_WORDS.filter(isAsciiWord);
const HANGUL_WORDS = ALL_WORDS.filter((w) => !isAsciiWord(w));

/** 공백·특수문자를 지운 본문. 한글 단어는 여기에 대고 찾는다. */
const squash = (text: string) => text.toLowerCase().replace(FILLER_RE, "");

const ALLOWLIST_RE = (() => {
  const squashed = prepare(PROFANITY_ALLOWLIST).map(squash).filter(Boolean);
  return squashed.length
    ? new RegExp(squashed.map(escapeRe).join("|"), "g")
    : null;
})();

// 한글은 단어 경계라는 게 없어서 부분 일치로 찾는다.
const HANGUL_RE = HANGUL_WORDS.length
  ? new RegExp(HANGUL_WORDS.map(escapeRe).join("|"), "g")
  : null;

// 영문은 앞뒤가 영문·숫자가 아닐 때만. 뒤쪽은 lookahead면 충분하지만
// 앞쪽은 lookbehind 지원이 엔진마다 갈려서 한 글자 먹고 들어간다.
const ASCII_RE = ASCII_WORDS.length
  ? new RegExp(
      `(?:^|[^a-z0-9])(${ASCII_WORDS.map(escapeRe).join("|")})(?![a-z0-9])`,
      "g",
    )
  : null;

/** 정규식에 g 플래그가 있으면 lastIndex가 남으므로 매번 0으로 되돌린다 */
const collect = (re: RegExp, text: string, group: number, out: Set<string>) => {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.add(m[group]);
    // 빈 매치로 무한 루프에 빠지지 않게 (있을 수 없지만 안전장치)
    if (m.index === re.lastIndex) re.lastIndex += 1;
  }
};

/* ------------------------------------------------------------------ */
/* 3. 공개 API                                                          */
/* ------------------------------------------------------------------ */

/**
 * 걸린 단어들을 돌려준다. 화면에 보여주진 말고(우회를 학습시키게 된다)
 * 로그나 신고 연동용으로만 쓰는 걸 권한다.
 */
export function findProfanity(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();

  if (HANGUL_RE) {
    let squashed = squash(text);
    if (ALLOWLIST_RE) {
      ALLOWLIST_RE.lastIndex = 0;
      squashed = squashed.replace(ALLOWLIST_RE, "");
    }
    collect(HANGUL_RE, squashed, 0, found);
  }

  if (ASCII_RE) {
    collect(ASCII_RE, text.toLowerCase(), 1, found);
  }

  return [...found];
}

/** 전송을 막아야 하는 메시지인지 */
export function hasProfanity(text: string): boolean {
  return findProfanity(text).length > 0;
}

/**
 * 여러 입력칸을 한 번에 검사하고, 걸리면 Alert 까지 띄운다.
 *
 * 화면마다 검사 코드를 다시 적지 않도록 저장/전송 직전에 한 줄로 부른다.
 *
 *   if (!assertClean({ 제목: title, "우리 팀 어필": content })) return;
 *
 * 키는 화면에 실제로 보이는 라벨을 그대로 쓴다. 사용자가 어느 칸을 고쳐야
 * 하는지 바로 알 수 있어야 해서다. 여러 칸이 걸려도 첫 칸만 알린다 —
 * 어차피 고치고 다시 누르면 다음 칸이 잡힌다.
 *
 * 검사는 '저장 직전'이지 '타이핑 중'이 아니다. 한글은 조합 중인 글자가
 * 잠깐 다른 글자로 보이기 때문에(ㅅ→시→십) 입력 중에 막으면 멀쩡한 말도
 * 걸리고, 무엇보다 글자가 지워지는 것처럼 보인다.
 */
export function assertClean(
  fields: Record<string, string | null | undefined>,
): boolean {
  for (const [label, value] of Object.entries(fields)) {
    if (value && hasProfanity(value)) {
      Alert.alert(PROFANITY_ALERT_TITLE, profanityFieldMessage(label));
      return false;
    }
  }
  return true;
}
