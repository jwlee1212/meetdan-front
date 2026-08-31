import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { Palette, Radius } from "@/constants/theme";

interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
}

/**
 * 필터용 알약 버튼.
 *
 * 고른 것은 브랜드색으로 채운다. 예전엔 검정으로 채웠는데, 검정은 앱 어디에서도
 * 다른 뜻으로 안 쓰이는 색이라 "눌러서 고른 상태"라는 신호가 약했다.
 * 파랑 = 내가 건드릴 수 있는 것, 이라는 규칙에 맞춘다.
 */
export function Chip({ label, selected = false, onPress }: ChipProps) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && styles.chipPressed,
      ]}
    >
      <Text style={[styles.text, selected && styles.textSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Palette.gray200,
    backgroundColor: Palette.white,
  },
  chipSelected: {
    backgroundColor: Palette.brand,
    borderColor: Palette.brand,
  },
  chipPressed: { opacity: 0.6 },
  text: {
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: -0.3,
    color: Palette.gray700,
  },
  textSelected: { color: Palette.white, fontWeight: "700" },
});

/** 게시글 본문에 붙는 해시태그. 누를 수 없는 표시용. */
export function TagPill({ label }: { label: string }) {
  return <Text style={tagStyles.tag}>{label}</Text>;
}

const tagStyles = StyleSheet.create({
  tag: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: -0.2,
    // gray50 위 gray500 은 2.91:1 이었다. 배경을 한 칸 진하게, 글씨도 진하게.
    color: Palette.gray700,
    backgroundColor: Palette.gray100,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: "hidden",
  },
});
