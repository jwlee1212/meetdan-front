// 파일: components/Logo.tsx
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, {
  Defs,
  LinearGradient,
  Stop,
  Rect,
  G,
  Circle,
  Path,
} from "react-native-svg";

import { Palette } from "@/constants/theme";

interface MeetDanLogoProps {
  size?: number; // 로고 크기 (기본 120)
  showText?: boolean; // 글자 보여줄지 여부 (기본 true)
}

export default function MeetDanLogo({
  size = 120,
  showText = true,
}: MeetDanLogoProps) {
  return (
    <View style={styles.container}>
      {/* 1. 로고 아이콘 (SVG) */}
      <View style={{ width: size, height: size }}>
        <Svg viewBox="0 0 120 120" style={{ width: "100%", height: "100%" }}>
          <Defs>
            <LinearGradient
              id="blueGradient"
              x1="0%"
              y1="0%"
              x2="100%"
              y2="100%"
            >
              <Stop offset="0%" stopColor={Palette.brand} />
              <Stop offset="100%" stopColor={Palette.brandPressed} />
            </LinearGradient>
          </Defs>

          {/* 배경 둥근 사각형 */}
          <Rect
            x="15"
            y="15"
            width="90"
            height="90"
            rx="24"
            fill="url(#blueGradient)"
          />

          {/* 아이콘 그룹. 하트까지 포함한 세로 범위가 -32~17이라
              중심을 맞추려고 60이 아니라 64로 내려 잡았다. */}
          <G x="60" y="64">
            {/* 왼쪽 사람 — 머리와 어깨가 붙어 있어야 "사람"으로 읽힌다.
                알약 모양 몸통은 떨어진 동그라미 두 개로 보인다. */}
            <Circle cx="-15" cy="-7" r="7" fill="white" />
            <Path
              d="M -15,3 C -6.5,3 -3.5,9 -3.5,17 L -26.5,17 C -26.5,9 -23.5,3 -15,3 Z"
              fill="white"
            />

            {/* 오른쪽 사람 */}
            <Circle cx="15" cy="-7" r="7" fill="white" />
            <Path
              d="M 15,3 C 23.5,3 26.5,9 26.5,17 L 3.5,17 C 3.5,9 6.5,3 15,3 Z"
              fill="white"
            />

            {/* 두 사람 위의 하트 */}
            <Path
              d="M 0,8.5 C -2.8,4.8 -9.5,0.5 -9.5,-3.8 C -9.5,-7.6 -6.2,-10 -3.3,-10 C -1.4,-10 -0.4,-8.6 0,-7.6 C 0.4,-8.6 1.4,-10 3.3,-10 C 6.2,-10 9.5,-7.6 9.5,-3.8 C 9.5,0.5 2.8,4.8 0,8.5 Z"
              fill={Palette.pinkOnBrand}
              transform="translate(0,-22)"
            />
          </G>
        </Svg>
      </View>

      {/* 2. 앱 이름 텍스트 */}
      {showText && (
        <View style={styles.textContainer}>
          {/* 앱에서는 텍스트 그라데이션이 복잡해서 깔끔한 브랜드 컬러로 대체했습니다 */}
          <Text style={[styles.title, { fontSize: size * 0.25 }]}>MeetDan</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    gap: 12, // 아이콘과 글자 사이 간격
  },
  textContainer: {
    alignItems: "center",
  },
  title: {
    fontWeight: "bold",
    color: Palette.brand,
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  subtitle: {
    fontWeight: "600",
    color: Palette.gray600,
  },
});
