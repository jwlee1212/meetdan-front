// 파일: components/home/fortune-line.tsx
// 오늘의 연애 운세 — 한 줄.
//
// 처음에는 팀 글과 같은 크기의 행으로 그렸다. 점수 타일, 등급 뱃지,
// "운세" 뱃지, 본문, 그리고 행운의 시간·MBTI·장소 3열 그리드까지.
// 화면에서 제일 큰 덩어리였는데 정작 누를 것도, 다시 볼 이유도 없었다.
//
// 운세는 스쳐 읽고 지나가는 것이다. 딱 그만큼의 자리만 준다 —
// 점수와 문장 하나. 행운의 무엇무엇은 예뻐 보이려고 넣은 것이라 지웠다.
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { Palette, Spacing, Typo } from "@/constants/theme";
import type { DailyFortune } from "@/utils/fortune";

export function FortuneLine({ fortune }: { fortune: DailyFortune }) {
  return (
    <View style={styles.line}>
      <Ionicons name="sparkles" size={14} color={Palette.gray400} />
      <Text style={styles.text} numberOfLines={2}>
        <Text style={styles.score}>연애운 {fortune.score}점</Text>
        {"  "}
        {fortune.message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  line: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    paddingHorizontal: Spacing.screen,
    paddingVertical: Spacing.md,
    backgroundColor: Palette.white,
  },
  text: {
    ...Typo.caption,
    flex: 1,
    lineHeight: 19,
    // 아이콘 높이와 첫 줄을 맞춘다
    marginTop: -1,
  },
  score: { color: Palette.gray900, fontWeight: "700" },
});
