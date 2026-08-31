// 파일: components/home/profile-banner.tsx
// 홈 맨 위의 얇은 안내 한 줄 — "프로필을 마저 채우세요".
//
// 예전에는 이걸 팀 글과 같은 모양의 목록 행으로 그렸다. 하지만 이건
// 읽을거리가 아니라 **할 일**이다. 운세·밸런스 게임과 같은 상자에 담으면
// "오늘 뭐 볼까"와 "내가 뭘 해야 하지"가 뒤섞여서, 화면이 실제보다 더
// 산만해 보인다.
//
// 그래서 목록 밖으로 꺼내 한 줄로 눕혔다. 다 채우면 사라지는 성격이라
// 자리를 크게 차지할 이유도 없다. 진행 막대도 뺐다 — 몇 개 남았는지는
// 우측의 2/3 하나면 충분하다.
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { Hairline, Palette, Spacing } from "@/constants/theme";
import type { ProfileProgress } from "@/utils/profile-progress";

interface ProfileBannerProps {
  progress: ProfileProgress;
  onPress: () => void;
}

export function ProfileBanner({ progress, onPress }: ProfileBannerProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.banner,
        pressed && { backgroundColor: Palette.gray100 },
      ]}
    >
      <Ionicons
        name="person-circle-outline"
        size={17}
        color={Palette.gray500}
      />

      <Text style={styles.text} numberOfLines={1}>
        {progress.title}
      </Text>

      {/* 몇 개 중 몇 개인지. 숫자 하나가 진행 막대보다 조용하고 정확하다.
          색은 여기 하나만 쓴다 — 이 줄에서 눈이 갈 곳은 "얼마나 남았나" 뿐이다. */}
      <Text style={styles.count}>
        {progress.done}/{progress.total}
      </Text>

      <Ionicons name="chevron-forward" size={15} color={Palette.gray300} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  /**
   * 파란 띠였다가 흰 줄로 낮췄다.
   *
   * 화면 맨 위의 색 띠는 광고처럼 읽힌다. 게다가 이 화면에서 색을 쓰는 곳은
   * 밸런스 게임의 두 칸 하나로 충분하다 — 색이 여러 군데면 어디를 보라는
   * 건지 알 수 없어진다. 아래 헤어라인 한 줄이면 "여긴 목록이 아니다"는
   * 말은 다 한 셈이다.
   */
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: Spacing.screen,
    paddingVertical: 11,
    backgroundColor: Palette.white,
    borderBottomWidth: Hairline.height,
    borderBottomColor: Hairline.color,
  },
  text: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: -0.3,
    color: Palette.gray700,
  },
  count: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: -0.2,
    color: Palette.brandText,
  },
});
