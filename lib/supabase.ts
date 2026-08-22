// 파일: lib/supabase.ts
// 앱 전체가 공유하는 Supabase 클라이언트. 여기서 만든 인스턴스 하나만 쓴다.
//
// 세션(액세스 토큰 + 리프레시 토큰)은 supabase-js 가 AsyncStorage 에 직접 저장하고
// 만료 전에 알아서 갱신한다. 예전 utils/auth.ts 의 수동 토큰 저장은 그래서 사라졌다.

import "react-native-url-polyfill/auto";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // EXPO_PUBLIC_* 값은 번들 시점에 박히므로, .env 를 고쳤으면
  // `npx expo start --clear` 로 다시 띄워야 반영된다.
  throw new Error(
    "EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY 가 없습니다.\n" +
      ".env 를 확인한 뒤 `npx expo start --clear` 로 다시 실행해주세요.",
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    // URL 의 해시로 세션을 받아오는 웹 전용 동작. 네이티브에서는 꺼둔다.
    detectSessionInUrl: false,
  },
});

// 백그라운드에서는 갱신 타이머를 멈추고 돌아오면 다시 켠다.
// 이게 없으면 오래 백그라운드에 있다가 복귀한 첫 요청이 401 로 튕긴다.
if (Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
