// 파일: components/home/feed-row.tsx
// 홈 피드 한 줄의 뼈대.
//
// 팀 공개글이든 운세든 프로필 안내든, 홈에 놓이는 줄은 전부 같은 골격을 쓴다.
//   [색 타일] 제목 / 메타 한 줄 / 미리보기 / 뱃지 줄
// 줄마다 모양이 다르면 스크롤하면서 눈이 매번 다시 배치를 읽어야 한다.
// 정보의 종류는 타일 색과 아이콘으로만 구분한다.
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { PressScale } from "@/components/ui/press-scale";
import { Palette, Radius, Spacing, Typo } from "@/constants/theme";

export interface FeedRowProps {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  /** 좌측 타일의 배경/전경색. GenderColor 같은 토큰을 그대로 넘긴다 */
  tile: { bg: string; fg: string };
  /** 타일 아래 작은 숫자. "2/4", "78" 처럼 아주 짧을 때만 */
  tileCaption?: string;
  title: string;
  /** 제목 아래 한 줄. 캠퍼스·시각처럼 가운뎃점으로 이어 붙인 메타 정보 */
  meta: string;
  excerpt?: string;
  excerptLines?: number;
  /** 뱃지·태그 줄 */
  children?: React.ReactNode;
  /** 뱃지 줄 아래에 더 붙일 것 (진행 막대 등) */
  footer?: React.ReactNode;
  /** 없으면 눌리지 않는 줄로 그린다 (운세처럼 읽기만 하는 정보) */
  onPress?: () => void;
}

export function FeedRow({
  icon,
  tile,
  tileCaption,
  title,
  meta,
  excerpt,
  excerptLines = 2,
  children,
  footer,
  onPress,
}: FeedRowProps) {
  const body = (
    <>
      {/* 좌측: 종류와 상태를 한눈에 읽히게 하는 색 타일 */}
      <View style={[styles.tile, { backgroundColor: tile.bg }]}>
        <Ionicons name={icon} size={20} color={tile.fg} />
        {!!tileCaption && (
          <Text style={[styles.tileCaption, { color: tile.fg }]} numberOfLines={1}>
            {tileCaption}
          </Text>
        )}
      </View>

      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>

        <Text style={styles.meta} numberOfLines={1}>
          {meta}
        </Text>

        {!!excerpt && (
          <Text style={styles.excerpt} numberOfLines={excerptLines}>
            {excerpt}
          </Text>
        )}

        {!!children && <View style={styles.badgeRow}>{children}</View>}
        {footer}
      </View>
    </>
  );

  if (!onPress) {
    return <View style={styles.row}>{body}</View>;
  }

  return (
    <PressScale scaleTo={0.99} style={styles.row} onPress={onPress}>
      {body}
    </PressScale>
  );
}

// 당근 피드처럼 좌우 끝까지 꽉 찬 행. 카드도 그림자도 없이 헤어라인으로만 나눈다.
const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: Spacing.md,
    paddingHorizontal: Spacing.screen,
    paddingVertical: Spacing.lg,
    backgroundColor: Palette.white,
  },
  tile: {
    width: 54,
    height: 54,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
  },
  tileCaption: { fontSize: 11, fontWeight: "800", letterSpacing: -0.2 },

  body: { flex: 1 },
  title: { ...Typo.subtitle, marginBottom: 2 },
  meta: { ...Typo.caption, fontSize: 12 },
  excerpt: {
    ...Typo.caption,
    color: Palette.gray500,
    marginTop: 4,
    lineHeight: 18,
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 5,
    marginTop: Spacing.sm,
  },
});
