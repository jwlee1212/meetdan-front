import React from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Palette, Radius, Spacing, Typo } from "@/constants/theme";

interface EmptyStateProps {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** 아래에 덧붙일 안내(팁 목록 등) */
  children?: React.ReactNode;
}

/**
 * 목록이 비었을 때.
 *
 * 카드로 감싸지 않는다. 빈 화면에 카드 한 장이 덩그러니 놓이면 오히려
 * 비어 있다는 사실이 강조된다. 대신 여백을 줄여 위로 끌어올리고,
 * 다음에 할 일(버튼 + 힌트 몇 줄)을 같이 줘서 화면을 내용으로 채운다.
 */
export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  children,
}: EmptyStateProps) {
  return (
    <View style={styles.card}>
      <View style={styles.iconCircle}>
        <Ionicons name={icon} size={26} color={Palette.brand} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {!!description && <Text style={styles.description}>{description}</Text>}
      {!!actionLabel && !!onAction && (
        <Pressable
          onPress={onAction}
          style={({ pressed }) => [styles.action, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.actionText}>{actionLabel}</Text>
        </Pressable>
      )}
      {children}
    </View>
  );
}

/**
 * 빈 화면 아래에 붙이는 한 줄짜리 팁.
 * 할 일을 몇 개 보여주면 화면이 비어 있어도 다음 행동이 보인다.
 */
export function EmptyHint({
  icon,
  text,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  text: string;
}) {
  return (
    <View style={hintStyles.row}>
      <Ionicons name={icon} size={15} color={Palette.gray500} />
      <Text style={hintStyles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: "center",
    paddingTop: Spacing.xxxl,
    paddingBottom: Spacing.xxl,
    paddingHorizontal: Spacing.xxl,
    // 회색 바탕 화면(마이·내 팀)에서도 흰 블록으로 읽히게 한다
    backgroundColor: Palette.white,
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: Radius.full,
    backgroundColor: Palette.brandWeak,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.md,
  },
  title: {
    ...Typo.subtitle,
    textAlign: "center",
  },
  description: {
    ...Typo.caption,
    marginTop: 5,
    textAlign: "center",
    lineHeight: 19,
  },
  action: {
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.xxl,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Palette.brand,
  },
  actionText: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: Palette.white,
  },
});

const hintStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    gap: 7,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 9,
    borderRadius: Radius.sm,
    backgroundColor: Palette.gray100,
  },
  text: {
    flex: 1,
    fontSize: 13,
    fontWeight: "500",
    letterSpacing: -0.2,
    color: Palette.gray600,
  },
});
