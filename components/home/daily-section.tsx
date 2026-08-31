// 파일: components/home/daily-section.tsx
// 홈 맨 위, 매일 바뀌는 것들의 자리.
//
// 왜 묶는가
//   운세와 밸런스 게임을 팀 글 사이에 하나씩 끼워 넣었더니, 셋 다 팀 글과
//   같은 행 모양이라 "게시글 다섯 개 중 셋이 가짜"처럼 읽혔다. 채워진 척이
//   오히려 비어 있다는 걸 강조한 셈이다. 그래서 한 묶음으로 담고 팀 목록과는
//   회색 띠로 끊는다. 아래 목록에는 진짜 팀 글만 남는다.
//
// 무엇이 주인공인가
//   밸런스 게임이다. 누를 것이 있고, 매일 답이 달라지고, 남들 답이 궁금하다.
//   그래서 질문을 제목 크기로 쓰고 제일 위에 둔다. 운세는 그 아래 한 줄로
//   스쳐 지나간다 — 이 둘의 크기가 같으면 어느 쪽을 보라는 건지 알 수 없다.
//
// 왜 접는가
//   이 콘텐츠는 애초에 게시글 부족을 메우려고 넣은 것이다. 팀 글이 자리를
//   잡으면 물러나야 한다. 그 의도를 코드에 남겨두지 않으면, 나중에 유저가
//   늘었을 때 누군가 이 화면을 처음부터 다시 고민하게 된다.
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { BalanceChoice, BalanceGame } from "@/api/client";
import { BalanceRow } from "@/components/home/balance-row";
import { FortuneLine } from "@/components/home/fortune-line";
import { Divider, SectionHeader } from "@/components/ui/screen";
import { Palette, Spacing, Typo } from "@/constants/theme";
import type { DailyFortune } from "@/utils/fortune";

interface DailySectionProps {
  fortune: DailyFortune | null;
  balance: BalanceGame | null;
  onVote: (choice: BalanceChoice) => void;
  /** 팀 글이 충분히 쌓여서 접어둘 수 있는 상태인가 */
  collapsible: boolean;
  expanded: boolean;
  onToggle: () => void;
}

export function DailySection({
  fortune,
  balance,
  onVote,
  collapsible,
  expanded,
  onToggle,
}: DailySectionProps) {
  // 둘 다 없으면(운세는 로그인 전, 밸런스는 마이그레이션 016 전) 섹션째로 없앤다.
  // 제목만 덩그러니 남으면 그게 제일 이상하다.
  if (!fortune && !balance) return null;

  if (collapsible && !expanded) {
    return (
      <Pressable
        onPress={onToggle}
        style={({ pressed }) => [
          styles.collapsed,
          pressed && { backgroundColor: Palette.gray100 },
        ]}
      >
        <Text style={styles.collapsedText}>오늘의 질문 보기</Text>
        <Ionicons name="chevron-down" size={16} color={Palette.gray400} />
      </Pressable>
    );
  }

  return (
    <View>
      <SectionHeader
        title="오늘의 질문"
        // 접을 수 있을 때만 접기 버튼을 준다. 팀 글이 몇 개 없는데 접게
        // 두면 홈이 통째로 비어버린다.
        actionLabel={collapsible ? "접기" : undefined}
        onAction={collapsible ? onToggle : undefined}
      />

      {!!balance && <BalanceRow game={balance} onVote={onVote} />}
      {!!balance && !!fortune && <Divider inset={Spacing.screen} />}
      {!!fortune && <FortuneLine fortune={fortune} />}
    </View>
  );
}

const styles = StyleSheet.create({
  collapsed: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.screen,
    paddingVertical: Spacing.md,
    backgroundColor: Palette.white,
  },
  collapsedText: {
    ...Typo.caption,
    flex: 1,
    fontWeight: "600",
    color: Palette.gray700,
  },
});
