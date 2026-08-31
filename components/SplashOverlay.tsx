// 파일: components/SplashOverlay.tsx
// 앱을 켤 때 잠깐 덮는 브랜드 화면. 한 줄 문구에서 로고로 넘어간다.
//
// ── 네이티브 스플래시와의 이어달리기 ──────────────────────────────
// iOS 는 네이티브 스플래시(app.json 의 expo-splash-screen)가 이 화면과
// **똑같은 문구 이미지**를 띄운다. 그래서 순서가 이렇게 된다.
//
//   [네이티브] 문구 → (그림이 준비되면 네이티브를 내림) → [JS] 같은 문구 → 로고
//
// 같은 파일을 같은 크기(168×33pt)로, 같은 자리(화면 정중앙)에 그리므로
// 넘어가는 순간이 보이지 않는다. 문구를 <Text> 가 아니라 이미지로 그리는
// 이유가 이것이다 — 글자로 그리면 네이티브 쪽 그림과 한 픽셀도 안 맞는다.
//
// 안드로이드는 12부터 스플래시 아이콘을 원형으로 잘라내서 가로로 긴 문구를
// 넣을 수 없다. 그쪽은 앱 아이콘이 먼저 뜨므로, 문구를 페이드인시켜 붙인다.
//
// ── 언제 사라지는가 ────────────────────────────────────────────
// "연출이 끝났는가"와 "앱이 준비됐는가"를 따로 본다. 세션은 대개 0.2초면
// 복원되는데 그것만 보고 걷어내면 문구가 뜨다 마는 깜빡임이 되고, 반대로
// 복원이 늦으면 로고를 띄운 채 기다려야 한다.
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Image, Platform, StyleSheet } from "react-native";

import MeetDanLogo from "@/components/Logo";
import { Palette } from "@/constants/theme";

const TAGLINE_SOURCE = require("../assets/images/splash-tagline.png");

/**
 * 문구 이미지의 표시 크기(pt). app.json 의 ios.imageWidth 와 반드시 같아야
 * 네이티브 스플래시에서 넘어올 때 크기가 튀지 않는다.
 * (원본 504×99px = @3x 기준 168×33pt)
 */
const TAGLINE_WIDTH = 168;
const TAGLINE_HEIGHT = 33;

/**
 * 연출 길이. 문구가 보이기 시작한 뒤로 약 2초다.
 *
 * 머무는 시간(HOLD)이 아니라 움직이는 구간을 늘려 잡았다. 넘어가는 동작이
 * 빠르면 "바뀌었다"만 남고 무엇이 무엇으로 바뀌었는지가 안 보인다.
 * 반대로 머무는 시간까지 늘리면 그냥 기다림이 된다.
 */
// iOS 는 네이티브 스플래시가 이미 같은 문구를 띄워둔 상태라 다시 나타낼 게 없다.
const TAGLINE_IN = Platform.OS === "ios" ? 0 : 480;
const TAGLINE_HOLD = Platform.OS === "ios" ? 560 : 320;
const TAGLINE_OUT = 420;
/** 문구가 사라지기 시작하고 조금 뒤에 로고가 들어온다 (겹치는 구간이 있어야 이어져 보인다) */
const LOGO_DELAY = 160;
const LOGO_IN = 660;
/** 로고가 자리 잡은 걸 눈으로 확인할 여유 */
const LOGO_HOLD = 220;
const FADE_OUT = 420;

/** 이미지 onLoad 가 끝내 안 오더라도 네이티브 스플래시에 갇히지 않게 하는 상한 */
const IMAGE_WAIT_LIMIT = 1200;

interface SplashOverlayProps {
  /** 세션 복원 등 앱 준비가 끝났는가 */
  isAppReady: boolean;
  /** 사라지는 애니메이션까지 끝났을 때. 부모가 이걸 받아 화면을 내린다 */
  onFinish: () => void;
}

export function SplashOverlay({ isAppReady, onFinish }: SplashOverlayProps) {
  // 등장과 퇴장을 한 값으로 묶지 않는다. 들어올 때는 감속(out), 나갈 때는
  // 가속(in) 이어야 자연스러운데 값 하나에는 곡선을 하나만 걸 수 있다.
  const taglineIn = useRef(
    // iOS 는 첫 프레임부터 문구가 떠 있어야 한다. 네이티브를 내리는 순간
    // 투명한 화면이 한 프레임이라도 비치면 그게 바로 깜빡임이다.
    new Animated.Value(Platform.OS === "ios" ? 1 : 0),
  ).current;
  const taglineOut = useRef(new Animated.Value(0)).current;
  const logoIn = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;

  /** 문구 그림이 실제로 화면에 올라왔는가 (= 네이티브 스플래시를 내려도 되는가) */
  const [taglineShown, setTaglineShown] = useState(false);
  const [introDone, setIntroDone] = useState(false);

  // 부모가 넘기는 onFinish 는 인라인 화살표라 리렌더마다 새 함수가 된다.
  // 그걸 아래 효과의 의존성에 그대로 두면 부모가 한 번 다시 그릴 때마다
  // 사라지는 애니메이션이 처음부터 다시 시작돼 화면이 덜컥거린다.
  const onFinishRef = useRef(onFinish);
  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  // 그림이 늦거나 onLoad 가 안 오는 경우의 안전장치. 네이티브 스플래시가
  // 계속 떠 있으면 앱이 멈춘 것처럼 보인다.
  useEffect(() => {
    const timer = setTimeout(() => setTaglineShown(true), IMAGE_WAIT_LIMIT);
    return () => clearTimeout(timer);
  }, []);

  // 문구가 준비된 뒤에 네이티브 스플래시를 내린다. 순서가 반대면 iOS 에서
  // 문구가 사라졌다 다시 나타난다.
  useEffect(() => {
    if (!taglineShown) return;
    SplashScreen.hideAsync().catch(() => {
      // 이미 내려갔거나 스플래시가 없는 환경(웹 등). 연출은 그대로 진행한다.
    });
  }, [taglineShown]);

  // 연출은 문구가 실제로 보이기 시작한 시점부터 센다.
  useEffect(() => {
    if (!taglineShown) return;

    const intro = Animated.sequence([
      Animated.timing(taglineIn, {
        toValue: 1,
        duration: TAGLINE_IN,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.delay(TAGLINE_HOLD),
      Animated.parallel([
        Animated.timing(taglineOut, {
          toValue: 1,
          duration: TAGLINE_OUT,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.delay(LOGO_DELAY),
          Animated.timing(logoIn, {
            toValue: 1,
            duration: LOGO_IN,
            // back 은 1을 살짝 넘었다 돌아온다. 로고가 "톡" 하고 놓이는 느낌.
            easing: Easing.out(Easing.back(1.3)),
            useNativeDriver: true,
          }),
        ]),
      ]),
      Animated.delay(LOGO_HOLD),
    ]);

    intro.start(({ finished }) => {
      if (finished) setIntroDone(true);
    });

    return () => intro.stop();
  }, [taglineShown, taglineIn, taglineOut, logoIn]);

  useEffect(() => {
    if (!introDone || !isAppReady) return;

    Animated.timing(fade, {
      toValue: 0,
      duration: FADE_OUT,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(() => onFinishRef.current());
    // 중간에 끊겨도(화면 전환 등) 덮개는 반드시 걷어야 하므로 finished 를 따지지 않는다
  }, [introDone, isAppReady, fade]);

  // 문구는 뜨면서 살짝 올라오고, 나갈 때 한 번 더 위로 빠진다.
  const taglineOpacity = Animated.multiply(
    taglineIn,
    taglineOut.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
  );
  const taglineY = Animated.add(
    taglineIn.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }),
    taglineOut.interpolate({ inputRange: [0, 1], outputRange: [0, -16] }),
  );

  // 투명도는 back 곡선의 오버슈트(>1)를 타면 안 되니 앞쪽 절반에서 끝내고 고정한다.
  const logoOpacity = logoIn.interpolate({
    inputRange: [0, 0.45, 1],
    outputRange: [0, 1, 1],
    extrapolate: "clamp",
  });
  const logoScale = logoIn.interpolate({
    inputRange: [0, 1],
    outputRange: [0.82, 1],
  });

  return (
    <Animated.View style={[styles.container, { opacity: fade }]}>
      {/* 문구와 로고를 같은 자리에 겹쳐 둔다. 위치를 옮기지 않고 그 자리에서
          하나가 빠지고 하나가 들어와야 "넘어간다"로 읽힌다. */}
      <Animated.View
        style={[
          styles.layer,
          { opacity: taglineOpacity, transform: [{ translateY: taglineY }] },
        ]}
      >
        <Image
          source={TAGLINE_SOURCE}
          style={styles.tagline}
          resizeMode="contain"
          // 안드로이드 <Image> 는 기본으로 300ms 페이드인이 붙는다.
          // 투명도는 우리가 직접 다루므로 꺼둔다.
          fadeDuration={0}
          onLoad={() => {
            // onLoad 는 "그릴 준비가 됐다"이지 "그려졌다"가 아니다.
            // 한 프레임 뒤에 네이티브 스플래시를 내려야 사이가 안 벌어진다.
            requestAnimationFrame(() => setTaglineShown(true));
          }}
          accessible
          accessibilityRole="image"
          accessibilityLabel="학교에서 사랑을 찾다"
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.layer,
          { opacity: logoOpacity, transform: [{ scale: logoScale }] },
        ]}
      >
        <MeetDanLogo size={150} showText />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Palette.white,
    alignItems: "center",
    justifyContent: "center",
    // 어떤 화면 위에도 확실히 덮이게
    zIndex: 9999,
  },
  // 부모가 가운데 정렬이라 offset 없이 absolute 만 주면 제자리에 겹친다
  layer: { position: "absolute" },
  tagline: { width: TAGLINE_WIDTH, height: TAGLINE_HEIGHT },
});
