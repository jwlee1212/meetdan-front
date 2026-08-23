// 파일: app/_layout.tsx
import * as Notifications from "expo-notifications";
import { Stack, useRouter, useSegments, useRootNavigationState } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useRef, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { View, StyleSheet } from "react-native";
import type { Session } from "@supabase/supabase-js";

import { API } from "@/api/client";
import MeetDanLogo from "@/components/Logo";
import { registerForPushNotifications, setBadgeCount } from "@/lib/push";
import { supabase } from "@/lib/supabase";
import { useStore } from "@/store/useStore";
import { readPushPayload } from "@/utils/notifications";

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

  // 앱 아이콘 뱃지가 따라가는 값. 알림 도착·읽음이 여기 모인다.
  const unreadCount = useStore((state) => state.unreadCount);

  // 이미 처리한 푸시 탭. 앱이 꺼진 상태에서 눌린 알림은 리스너와
  // getLastNotificationResponseAsync 양쪽으로 들어올 수 있다.
  const handledPushes = useRef<Set<string>>(new Set());

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

  // 5️⃣ 알림 — 안 읽은 개수를 한 번 세고, 그 뒤로는 Realtime 이 밀어 넣는다.
  //
  //    화면이 아니라 여기서 구독하는 이유: 알림이 도착할 때 사용자는 대개
  //    알림 화면에 있지 않다. 홈 헤더의 빨간 점이 어느 탭에 있든 켜지려면
  //    구독이 화면보다 오래 살아 있어야 한다.
  //
  //    끊겼다 붙는 사이에 놓친 알림은 여기서 메우지 않는다. 홈 탭이 화면에
  //    들어올 때마다 개수를 다시 세므로((tabs)/index.tsx) 그쪽에서 맞춰진다.
  useEffect(() => {
    const userId = session?.user.id;
    if (!userId) return;

    let cancelled = false;

    (async () => {
      const unread = await API.getUnreadNotificationCount();
      if (cancelled) return;
      if (unread.code === 200 && unread.data !== undefined) {
        useStore.getState().setUnreadCount(unread.data);
      }
    })();

    const unsubscribe = API.subscribeToNotifications(userId, (item) =>
      useStore.getState().addNotification(item),
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [session?.user.id]);

  // 6️⃣ 이 기기를 푸시 대상으로 등록한다.
  //
  //    앱을 켤 때마다 부른다 — 토큰은 재설치·업데이트로 바뀌고, 같은 기기를
  //    다른 계정이 쓰기 시작했을 수도 있다.
  //
  //    실패는 정상 흐름이다. 시뮬레이터·Expo Go·웹이거나 알림 권한을 거부한
  //    경우 null 이 오고, 그러면 푸시 없이 알림 센터만 쓰게 된다.
  useEffect(() => {
    if (!session?.user.id) return;

    let cancelled = false;
    (async () => {
      const registered = await registerForPushNotifications();
      if (cancelled || !registered) return;
      await API.savePushToken(registered.token, registered.platform);
    })();

    return () => {
      cancelled = true;
    };
  }, [session?.user.id]);

  // 7️⃣ 앱 아이콘 뱃지를 안 읽은 알림 수에 맞춘다.
  //    (앱이 꺼져 있는 동안의 뱃지는 서버가 푸시에 실어 보낸다)
  useEffect(() => {
    setBadgeCount(unreadCount);
  }, [unreadCount]);

  // 8️⃣ 푸시를 눌러서 앱에 들어온 경우 — 알림이 가리키는 화면으로 보낸다.
  //
  //    두 갈래를 모두 받아야 한다.
  //      · 앱이 떠 있거나 백그라운드에 있었다 → 리스너
  //      · 앱이 꺼져 있었다                  → getLastNotificationResponseAsync
  //    같은 알림이 양쪽으로 들어올 수 있어서 한 번 처리한 id 는 기억해 둔다.
  //
  //    라우터가 준비되기 전에 밀어 넣으면 이동이 사라지므로
  //    navigationState?.key 를 기다린다.
  useEffect(() => {
    if (!navigationState?.key || !session?.user.id) return;

    const open = (response: Notifications.NotificationResponse) => {
      const requestId = response.notification.request.identifier;
      if (handledPushes.current.has(requestId)) return;
      handledPushes.current.add(requestId);

      const { notificationId, target } = readPushPayload(
        response.notification.request.content.data as Record<string, unknown>,
      );

      // 눌러서 봤으면 읽은 것이다. 목록을 열지 않아도 뱃지가 줄어야 한다.
      if (notificationId) {
        useStore.getState().markNotificationRead(notificationId);
        API.markNotificationRead(notificationId);
      }

      if (!target) return;
      if (target.mode === "replace") router.replace(target.href as any);
      else router.push(target.href as any);
    };

    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) open(response);
      })
      .catch(() => {
        // 알림 없이 켜진 평범한 실행이다
      });

    const subscription =
      Notifications.addNotificationResponseReceivedListener(open);

    return () => subscription.remove();
  }, [navigationState?.key, session?.user.id, router]);

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
