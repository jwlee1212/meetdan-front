import React from "react";
import { StyleSheet, Text, View, ViewStyle } from "react-native";

import { Palette } from "@/constants/theme";

export type BadgeTone =
  | "neutral"
  | "brand"
  | "success"
  | "danger"
  | "warn"
  | "solid";

/**
 * 옅은 배경 + 진한 글씨 조합. 전부 배경 위에서 4.5:1 이상으로 맞춰둔 짝이라
 * 한쪽만 바꾸면 대비가 깨진다. 바꿀 땐 두 값을 같이 본다.
 *
 * solid 만 예외로 채운 브랜드색이다. "정보"가 아니라 "지금 이 팀이 공개중"처럼
 * 강하게 튀어야 하는 한 가지에만 쓴다.
 */
const TONES: Record<BadgeTone, { bg: string; fg: string }> = {
  neutral: { bg: Palette.gray100, fg: Palette.gray700 },
  brand: { bg: Palette.brandWeak, fg: Palette.brandText },
  success: { bg: Palette.greenWeak, fg: Palette.greenText },
  danger: { bg: Palette.redWeak, fg: Palette.redText },
  warn: { bg: Palette.orangeWeak, fg: Palette.orangeText },
  solid: { bg: Palette.brand, fg: Palette.white },
};

interface BadgeProps {
  label: string;
  tone?: BadgeTone;
  /** 토큰 색 대신 직접 지정하고 싶을 때 */
  colors?: { bg: string; fg: string };
  style?: ViewStyle;
}

/** 캠퍼스·학과·상태처럼 짧은 메타 정보를 감싸는 작은 알약. */
export function Badge({ label, tone = "neutral", colors, style }: BadgeProps) {
  const c = colors ?? TONES[tone];
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }, style]}>
      <Text style={[styles.text, { color: c.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: "flex-start",
  },
  text: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
});
