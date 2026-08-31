import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Hairline, Palette, Spacing } from "@/constants/theme";

export interface SegmentItem<T extends string> {
  value: T;
  label: string;
  /** 라벨 뒤에 붙는 개수. 0이면 표시하지 않는다. */
  count?: number;
}

interface SegmentedProps<T extends string> {
  items: SegmentItem<T>[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * 밑줄 탭.
 *
 * 예전엔 회색 트랙 위에 알약이 얹히는 세그먼트였는데, 목록 화면이 흰 바탕이
 * 되면서 트랙이 배경에 묻혔다. 흰 피드 위에서 탭을 나누는 건 토스도 당근도
 * 밑줄로 한다 — 알약과 달리 가로폭을 안 잡아먹고, 목록과 같은 흰 면 위에
 * 그대로 얹히기 때문이다.
 */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
}: SegmentedProps<T>) {
  return (
    <View style={styles.track}>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <Pressable
            key={item.value}
            onPress={() => onChange(item.value)}
            style={({ pressed }) => [
              styles.segment,
              active && styles.segmentActive,
              pressed && !active && { opacity: 0.6 },
            ]}
          >
            <Text
              style={[styles.label, active && styles.labelActive]}
              numberOfLines={1}
            >
              {item.label}
              {!!item.count && (
                <Text style={active ? styles.countActive : styles.count}>
                  {"  "}
                  {item.count}
                </Text>
              )}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    backgroundColor: Palette.white,
    paddingHorizontal: Spacing.sm,
    borderBottomWidth: Hairline.height,
    borderBottomColor: Hairline.color,
  },
  segment: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 13,
    // 활성 밑줄과 같은 두께를 미리 깔아둔다. 안 그러면 탭을 옮길 때마다
    // 글자가 2px 씩 위아래로 튄다.
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  segmentActive: {
    borderBottomColor: Palette.gray900,
  },
  label: {
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: -0.3,
    color: Palette.gray600,
  },
  labelActive: { color: Palette.gray900, fontWeight: "700" },
  count: { color: Palette.gray500 },
  countActive: { color: Palette.brand },
});
