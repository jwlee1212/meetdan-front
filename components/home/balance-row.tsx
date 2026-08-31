// 파일: components/home/balance-row.tsx
// 오늘의 밸런스 게임 — 질문 하나와 투표 막대.
//
// 두 선택지가 좌우로 한 줄을 반씩 나눠 갖는다. 고르고 나면 그 줄이 득표율
// 대로 다시 갈리면서 많이 받은 쪽이 길어진다 — 숫자를 읽기 전에 "어느 쪽이
// 이겼는지"가 먼저 보이는 게 목적이다.
//
// 설명 문구를 달지 않는다. 색이 다른 칸 두 개가 나란히 있으면 누르라는
// 뜻이라는 걸 모두가 안다. "고르면 결과가 보여요" 같은 안내는 화면만
// 시끄럽게 하고 아무것도 알려주지 않는다.
//
// 고르기 전에는 결과를 보여주지 않는다. 먼저 보면 많은 쪽에 끌려가고,
// 그러면 투표가 아니라 다수 확인이 된다.
import React, { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { BalanceChoice, BalanceGame } from "@/api/client";
import { Palette, Radius, Spacing, Typo } from "@/constants/theme";

/**
 * A는 파랑, B는 분홍/빨강.
 * 이 화면에서 색을 쓰는 곳은 여기뿐이다. 나머지는 전부 흑백이라,
 * 눈이 자연히 "지금 누를 것" 으로 간다.
 */
const CHOICE_COLORS: Record<BalanceChoice, { bg: string; fg: string }> = {
  A: { bg: Palette.brandWeak, fg: Palette.brandText },
  B: { bg: Palette.pinkWeak, fg: Palette.redText },
};

/**
 * 한쪽이 차지할 수 있는 최소 폭(%).
 *
 * 92:8 같은 날 8%를 그대로 그리면 그 칸이 20px도 안 돼 숫자조차 안 들어간다.
 * 폭에만 하한을 두고, 적는 숫자는 언제나 진짜 득표율이다.
 */
const MIN_SHARE = 22;

/** 이보다 좁은 칸은 글자를 빼고 숫자만 남긴다 (다 안 들어가서 "가…" 가 된다) */
const COMPACT_SHARE = 32;

const GROW_MS = 700;

interface BalanceRowProps {
  game: BalanceGame;
  onVote: (choice: BalanceChoice) => void;
}

export function BalanceRow({ game, onVote }: BalanceRowProps) {
  const total = game.votesA + game.votesB;
  const voted = game.myChoice != null;

  // 반올림을 각각 하면 49% + 50% 처럼 합이 100이 아닌 날이 생긴다.
  // 한쪽만 반올림하고 나머지를 빼서 채운다.
  const percentA = total > 0 ? Math.round((game.votesA / total) * 100) : 50;
  const percentB = 100 - percentA;

  const shareA = voted
    ? Math.min(Math.max(percentA, MIN_SHARE), 100 - MIN_SHARE)
    : 50;

  // 고르기 전에는 0(=반반), 고르고 나면 1(=득표율)로 간다. 이미 고른 뒤에
  // 다시 들어온 경우엔 1에서 시작해 애니메이션 없이 결과를 보여준다.
  const grow = useRef(new Animated.Value(voted ? 1 : 0)).current;

  useEffect(() => {
    if (!voted) return;
    Animated.timing(grow, {
      toValue: 1,
      duration: GROW_MS,
      easing: Easing.out(Easing.cubic),
      // 폭은 네이티브 드라이버가 다루지 못한다. 한 줄짜리라 부담은 없다.
      useNativeDriver: false,
    }).start();
  }, [voted, grow]);

  // A만 폭을 정하고 B는 남은 자리를 채운다. 둘 다 %로 주면 반올림 때문에
  // 합이 100을 넘거나 모자라 한 칸이 삐져나온다.
  const widthA = grow.interpolate({
    inputRange: [0, 1],
    outputRange: ["50%", `${shareA}%`],
  });

  return (
    <View style={styles.block}>
      <Text style={styles.question}>{game.question}</Text>

      <View style={styles.bar}>
        <Animated.View style={{ width: widthA }}>
          <Side
            choice="A"
            label={game.optionA}
            percent={percentA}
            share={shareA}
            voted={voted}
            mine={game.myChoice === "A"}
            onPress={() => onVote("A")}
          />
        </Animated.View>

        <View style={styles.rest}>
          <Side
            choice="B"
            label={game.optionB}
            percent={percentB}
            share={100 - shareA}
            voted={voted}
            mine={game.myChoice === "B"}
            onPress={() => onVote("B")}
          />
        </View>
      </View>

      {/* 참여자 수가 곧 결과의 신뢰도다. 표가 셋뿐이면 "3명"이 그렇게 말해 준다.
          "아직 참여가 적어요" 같은 문장을 따로 붙일 필요가 없다. */}
      {voted && <Text style={styles.count}>{total}명 참여</Text>}
    </View>
  );
}

interface SideProps {
  choice: BalanceChoice;
  label: string;
  /** 화면에 적는 진짜 득표율 */
  percent: number;
  /** 이 칸이 실제로 차지한 폭(%). 글자를 넣을 수 있는지 판단하는 데 쓴다 */
  share: number;
  voted: boolean;
  mine: boolean;
  onPress: () => void;
}

function Side({
  choice,
  label,
  percent,
  share,
  voted,
  mine,
  onPress,
}: SideProps) {
  const c = CHOICE_COLORS[choice];

  // 내가 고른 쪽에만 테두리를 두른다. 좁아져도 안 밀리고, 체크 아이콘처럼
  // 자리를 더 잡아먹지도 않는다. (반대쪽도 같은 두께의 투명 테두리를 둬야
  // 두 칸의 안쪽 크기가 같다)
  const style = [
    styles.side,
    { backgroundColor: c.bg, borderColor: mine ? c.fg : "transparent" },
  ];

  if (!voted) {
    // 두 칸이 맞붙어 있어서 눌림 표시는 크기가 아니라 투명도로 준다.
    // 줄어들면 옆 칸과의 사이가 벌어져 한 줄이 갈라져 보인다.
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [style, pressed && styles.pressed]}
      >
        <Text
          style={[styles.label, styles.center, { color: c.fg }]}
          numberOfLines={1}
        >
          {label}
        </Text>
      </Pressable>
    );
  }

  if (share < COMPACT_SHARE) {
    return (
      <View style={style}>
        <Text style={[styles.percent, styles.center, { color: c.fg }]}>
          {percent}%
        </Text>
      </View>
    );
  }

  // 글자는 바깥쪽, 숫자는 안쪽. 두 칸의 숫자가 가운데에서 마주 본다.
  return (
    <View style={style}>
      <View style={styles.content}>
        {choice === "B" && (
          <Text style={[styles.percent, { color: c.fg }]}>{percent}%</Text>
        )}
        <Text
          style={[styles.label, styles.shrink, { color: c.fg }]}
          numberOfLines={1}
        >
          {label}
        </Text>
        {choice === "A" && (
          <Text style={[styles.percent, { color: c.fg }]}>{percent}%</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    paddingHorizontal: Spacing.screen,
    paddingBottom: Spacing.lg,
    backgroundColor: Palette.white,
  },
  question: {
    ...Typo.subtitle,
    marginBottom: Spacing.md,
  },

  /**
   * 두 칸이 한 줄을 맞붙어 나눠 갖는다.
   *
   * 사이를 띄우면 그 간격만큼 한쪽이 좁아진다 — A는 "50%"인데 B는 남은
   * 자리(=50% 빼기 간격)라, 고르기 전 반반이어야 할 때부터 어긋난다.
   * 모서리는 부모가 잘라 주므로(overflow) 칸마다 둥글릴 필요도 없다.
   */
  bar: {
    flexDirection: "row",
    height: 46,
    borderRadius: Radius.sm,
    overflow: "hidden",
  },
  rest: { flex: 1 },

  side: {
    flex: 1,
    borderWidth: 1.5,
    justifyContent: "center",
    paddingHorizontal: 11,
  },
  pressed: { opacity: 0.75 },

  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  // 글자가 길면 글자만 줄어든다. 숫자는 끝까지 남아야 한다.
  shrink: { flexShrink: 1 },
  center: { textAlign: "center" },
  percent: { fontSize: 14, fontWeight: "800", letterSpacing: -0.3 },

  count: {
    ...Typo.caption,
    fontSize: 12,
    color: Palette.gray500,
    marginTop: Spacing.sm,
  },
});
