// 파일: lib/push.ts
//
// 기기 푸시 알림 — 권한을 받고, Expo 토큰을 얻고, 앱이 켜져 있을 때
// 알림이 어떻게 보일지 정한다.
//
// 서버로 토큰을 올리는 일은 여기서 하지 않는다. DB 호출은 전부
// api/client.ts 를 거치는 게 이 프로젝트의 규칙이라, 이 파일은 '기기에서
// 얻을 수 있는 것'까지만 책임지고 그 결과를 돌려준다.
//
// ⚠️ Expo Go 에서는 푸시가 오지 않는다
//    SDK 53 부터 Expo Go 는 원격 푸시를 지원하지 않는다. 개발 빌드
//    (development build) 나 실제 빌드에서만 토큰이 발급된다.
//    시뮬레이터도 마찬가지다 — 실기기가 있어야 한다.
//    그런 환경에서는 아래 함수가 조용히 null 을 돌려주고, 앱은 푸시 없이
//    그대로 굴러간다(알림 센터는 멀쩡하다).
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { Palette } from "@/constants/theme";

/**
 * 앱이 화면에 떠 있는 동안 알림이 도착했을 때의 처리.
 *
 * 배너는 띄우되 목록(알림 센터)에도 남긴다. 채팅 중에 상대 팀 소식이
 * 도착하는 상황이 흔한데, 그때 배너만 스쳐 지나가면 놓친다.
 *
 * 모듈을 불러오는 순간 등록된다. app/_layout.tsx 가 이 파일을 import 하므로
 * 앱이 켜지자마자 적용된다.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export type PushPlatform = "ios" | "android";

export interface PushRegistration {
  /** "ExponentPushToken[...]" */
  token: string;
  platform: PushPlatform;
}

/**
 * 이 기기에 등록해 둔 토큰.
 *
 * 로그아웃할 때 서버에서 지우려면 값을 알아야 하는데, 그때 다시 발급받는 건
 * 권한 대화상자를 또 띄울 수 있어 좋지 않다. 등록에 성공한 값을 들고 있는다.
 * (앱을 껐다 켜면 사라진다 — 그때는 다시 등록하면서 새로 채워진다)
 */
let registeredToken: string | null = null;

export const getRegisteredPushToken = (): string | null => registeredToken;

export const clearRegisteredPushToken = () => {
  registeredToken = null;
};

/**
 * EAS 프로젝트 id.
 *
 * SDK 49 부터 토큰을 받으려면 이 값이 있어야 한다. `eas init` 을 아직 안
 * 돌렸으면 app.json 에 없고, 그러면 푸시는 쓸 수 없다(빌드마다 달라지는
 * 값이라 손으로 적을 수 있는 게 아니다).
 */
const projectId = (): string | undefined =>
  Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

/**
 * 안드로이드 알림 채널.
 *
 * 채널이 없으면 알림이 소리도 진동도 없이 조용히 뜬다. 서버가 보내는
 * channelId("default", send-push Edge Function)와 이름이 같아야 한다.
 * 권한을 묻기 전에 만들어 둔다.
 */
async function ensureAndroidChannel() {
  if (Platform.OS !== "android") return;

  await Notifications.setNotificationChannelAsync("default", {
    name: "밋단 알림",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: Palette.brand,
  });
}

/**
 * 권한을 확인하고 토큰을 받아온다. 못 받으면 null.
 *
 * 못 받는 경우가 오류인 것은 아니다 — 시뮬레이터, Expo Go, 웹, 알림을
 * 거부한 사용자 모두 정상적으로 null 이다. 부르는 쪽은 null 을 받으면
 * 그냥 푸시 없이 진행하면 된다.
 *
 * ⚠️ 권한을 이미 거부한 사람에게 다시 묻지 않는다.
 *    iOS 는 두 번째 요청부터 대화상자를 띄우지 않고 바로 거부로 답한다.
 *    마음이 바뀐 사람은 설정에서 켜야 하고, 그러면 다음 실행 때 여기서
 *    granted 로 읽힌다.
 */
export async function registerForPushNotifications(): Promise<PushRegistration | null> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return null;

  // 시뮬레이터에는 푸시를 받을 기기 자체가 없다
  if (!Device.isDevice) {
    console.warn("[푸시] 실기기가 아니라 알림을 등록하지 않습니다.");
    return null;
  }

  const id = projectId();
  if (!id) {
    console.warn(
      "[푸시] EAS projectId 가 없어 알림을 등록하지 않습니다. " +
        "`eas init` 후 개발 빌드에서 다시 시도해주세요.",
    );
    return null;
  }

  try {
    await ensureAndroidChannel();

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;

    if (status !== "granted") {
      // 이미 한 번 거부했다면 다시 물어봐야 소용이 없다
      if (!existing.canAskAgain) return null;
      const asked = await Notifications.requestPermissionsAsync();
      status = asked.status;
    }

    if (status !== "granted") return null;

    const { data: token } = await Notifications.getExpoPushTokenAsync({
      projectId: id,
    });

    registeredToken = token;
    return { token, platform: Platform.OS };
  } catch (e) {
    // 네트워크가 끊겼거나 자격증명이 아직 없는 빌드다. 앱을 막을 이유는 없다.
    console.warn("[푸시] 토큰 발급 실패", e);
    return null;
  }
}

/** 앱 아이콘의 뱃지 숫자. 못 바꿔도 그만이라 실패는 삼킨다. */
export async function setBadgeCount(count: number) {
  try {
    await Notifications.setBadgeCountAsync(Math.max(0, count));
  } catch {
    // 안드로이드 런처에 따라 지원하지 않는다
  }
}
