// 파일: app/_layout.tsx
import { Stack, useRouter, useSegments, useRootNavigationState } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { View, StyleSheet } from "react-native";
import type { Session } from "@supabase/supabase-js";

import { API } from "@/api/client";
import MeetDanLogo from "@/components/Logo";
import { supabase } from "@/lib/supabase";
import { useStore } from "@/store/useStore";

// 앱이 로딩될 때까지 네이티브 화면 유지 (우리가 수동으로 끌 것임)
SplashScreen.preventAutoHideAsync();

/** 로그인 없이 들어갈 수 있는 화면들 */
const PUBLIC_ROUTES = ["login", "signupScreen"];

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  const navigationState = useRootNavigationState();

  // 저장된 세션을 다 읽기 전까지는 로고 화면으로 덮는다.
  const [isReady, setIsReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

  // 1️⃣ 앱이 켜지자마자 흰 네이티브 화면을 치워 우리 로고가 바로 보이게 한다
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  // 2️⃣ 저장된 세션 복원 + 이후의 로그인/로그아웃 구독
  //    supabase-js 가 AsyncStorage 에서 토큰을 읽고 만료됐으면 알아서 갱신한다.
  useEffect(() => {
    let cancelled = false;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        setSession(data.session);
      })
      .catch((e) => console.error("세션 복원 실패:", e))
      .finally(() => {
        if (!cancelled) setIsReady(true);
      });

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, next) => {
        setSession(next);
        // 로그아웃/토큰 만료 시 이전 유저 정보가 다음 계정에 새지 않게 비운다
        if (!next) useStore.getState().clearCurrentUser();
      },
    );

    // 🛡️ 세션 읽기가 예기치 않게 멈춰도 3초 뒤엔 문을 연다
    const timer = setTimeout(() => setIsReady(true), 3000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      subscription.subscription.unsubscribe();
    };
  }, []);

  // 3️⃣ 세션이 생기면 내 프로필을 전역 상태로 올린다.
  //    앱을 껐다 켜면 zustand 는 비어 있으므로 매번 다시 받아와야 한다.
  useEffect(() => {
    const userId = session?.user.id;
    if (!userId) return;
    if (useStore.getState().currentUser?.id === userId) return;

    let cancelled = false;
    (async () => {
      const me = await API.getMe();
      if (cancelled) return;

      if (me.code === 200 && me.data) {
        useStore.getState().setCurrentUser(me.data);
      } else if (me.code === 403 || me.code === 404) {
        // 탈퇴·정지·프로필 없는 반쪽 계정. 들여보내면 빈 화면만 보인다.
        console.warn("프로필 사용 불가:", me.message);
        await supabase.auth.signOut();
      }
      // 그 외(네트워크 오류 등)는 세션을 유지한 채 다음 기회에 다시 시도한다
    })();

    return () => {
      cancelled = true;
    };
  }, [session?.user.id]);

  // 4️⃣ 세션 유무에 따라 화면을 납치한다
  useEffect(() => {
    if (!isReady || !navigationState?.key) return;

    const inAuthGroup = PUBLIC_ROUTES.includes(segments[0] as string);
    const inRoot = (segments as string[]).length === 0;

    if (session && (inAuthGroup || inRoot)) {
      router.replace("/(tabs)");
    } else if (!session && !inAuthGroup) {
      router.replace("/login");
    }
  }, [isReady, session, segments, navigationState?.key]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* 화면들이 노치/홈바 여백을 직접 계산할 수 있게 인셋 제공 */}
      <SafeAreaProvider>
        {/* 1. 메인 앱 화면 (평소엔 여기 보임) */}
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="index" />
          <Stack.Screen name="login" />
          <Stack.Screen name="+not-found" />
        </Stack>

        {/* 2. 커스텀 스플래쉬 화면 (isReady가 false일 때만 덮어씌움) */}
        {!isReady && (
          <View style={styles.splashContainer}>
            <MeetDanLogo size={150} showText={true} />
          </View>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  splashContainer: {
    ...StyleSheet.absoluteFillObject, // 화면 전체 꽉 채우기
    backgroundColor: "#ffffff", // 배경색
    justifyContent: "center",
    alignItems: "center",
    zIndex: 9999, // 다른 화면보다 무조건 위에 뜨게
  },
});
