// 파일: utils/notifications.ts
//
// 알림 한 줄을 화면에 얹을 때 필요한 것들 — 아이콘·색, 눌렀을 때 갈 곳,
// 날짜 묶음. 문구(title/body)는 서버가 이미 만들어 보내므로 여기 없다.
//
// 경로를 서버가 아니라 여기서 만드는 이유:
// 알림은 몇 주씩 남아 있는데 앱 라우트는 그보다 자주 바뀐다. 서버가 경로
// 문자열을 저장해 두면 화면 이름 하나만 바꿔도 지난 알림이 전부 죽은 링크가
// 된다. 서버는 대상 id 만 남기고, 그 id 로 무엇을 여는지는 앱이 정한다.
import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";

import { Palette } from "@/constants/theme";
import type { AppNotification, NotificationKind } from "@/store/useStore";

type IconName = ComponentProps<typeof Ionicons>["name"];

export interface NotificationView {
  icon: IconName;
  /** 아이콘 색 */
  fg: string;
  /** 아이콘 원 배경색 */
  bg: string;
}

/**
 * 종류별 아이콘과 색.
 *
 * 좋은 소식(신청·성사·합류)에만 색을 쓰고, 아쉬운 소식(거절·취소)과 공지는
 * 회색으로 둔다. 알림 목록을 훑을 때 색이 있는 줄만 눈에 들어오게 하려는
 * 것이다 — 전부 알록달록하면 아무것도 강조되지 않는다.
 */
const VIEWS: Record<NotificationKind, NotificationView> = {
  MATCH_REQUEST: {
    icon: "heart",
    fg: Palette.brand,
    bg: Palette.brandWeak,
  },
  MATCH_ACCEPTED: {
    icon: "chatbubbles",
    fg: "#D97400",
    bg: Palette.orangeWeak,
  },
  MATCH_REJECTED: {
    icon: "close-circle",
    fg: Palette.gray500,
    bg: Palette.gray100,
  },
  MATCH_CANCELED: {
    icon: "arrow-undo",
    fg: Palette.gray500,
    bg: Palette.gray100,
  },
  TEAM_JOINED: {
    icon: "person-add",
    fg: "#0E9F5B",
    bg: Palette.greenWeak,
  },
  TEAM_READY: {
    icon: "people",
    fg: Palette.brand,
    bg: Palette.brandWeak,
  },
  PLAN_SET: {
    icon: "calendar",
    fg: "#E0417A",
    bg: Palette.pinkWeak,
  },
  NOTICE: {
    icon: "megaphone",
    fg: Palette.gray600,
    bg: Palette.gray100,
  },
};

/** 앱이 모르는 종류(서버에 값이 먼저 늘어난 경우)는 기본 종 아이콘으로 떨어진다. */
const FALLBACK_VIEW: NotificationView = {
  icon: "notifications",
  fg: Palette.gray600,
  bg: Palette.gray100,
};

export function notificationView(kind: NotificationKind): NotificationView {
  return VIEWS[kind] ?? FALLBACK_VIEW;
}

export interface NotificationTarget {
  href: string;
  /**
   * 탭으로 보낼 때는 replace 다. push 로 쌓으면 탭 위에 알림 화면이 남아
   * 뒤로가기가 알림 → 탭 → 알림처럼 되돌아온다.
   */
  mode: "push" | "replace";
}

/**
 * 눌렀을 때 갈 곳. 갈 데가 없으면(공지, 대상이 지워진 알림) null.
 *
 * ⚠️ 채팅방 경로는 chat_rooms.id 가 아니라 matches.id 를 쓴다.
 *    (app/chat/[id].tsx 의 [id] 가 매칭 id 다)
 */
export function notificationTarget(
  item: AppNotification,
): NotificationTarget | null {
  switch (item.kind) {
    // 수락·거절을 하러 간다
    case "MATCH_REQUEST":
      return item.matchId
        ? { href: `/match/party/${item.matchId}`, mode: "push" }
        : null;

    // 바로 대화를 시작하러 간다
    case "MATCH_ACCEPTED":
    case "PLAN_SET":
      return item.matchId
        ? { href: `/chat/${item.matchId}`, mode: "push" }
        : null;

    // 열어봐야 할 신청은 없다. 지난 신청이 모여 있는 활동 탭으로 보낸다.
    case "MATCH_REJECTED":
    case "MATCH_CANCELED":
      return { href: "/(tabs)/history", mode: "replace" };

    // 팀원 확인도 게시판 공개도 [내 팀] 탭에서 한다
    case "TEAM_JOINED":
    case "TEAM_READY":
      return { href: "/(tabs)/my_team", mode: "replace" };

    case "NOTICE":
      return null;

    default:
      return null;
  }
}

export interface NotificationGroup {
  /** 화면 안에서만 쓰는 식별자. 서버는 kinds 만 안다. */
  key: string;
  label: string;
  description: string;
  icon: IconName;
  /** 이 스위치 하나가 다스리는 알림 종류들 */
  kinds: NotificationKind[];
}

/**
 * 알림 설정 화면의 스위치 목록.
 *
 * 종류는 여덟인데 스위치는 넷이다. "매칭이 성사됐다"와 "거절됐다"를 따로
 * 끄고 싶은 사람은 없다 — 둘 다 '내가 보낸 신청이 어떻게 됐는지'다.
 * 사용자가 실제로 나누고 싶어 하는 단위로 묶는다.
 *
 * 묶음이 화면 쪽에 있는 것이 중요하다. 서버(notification_mutes)는 종류
 * 단위로만 저장하므로, 나중에 묶음을 쪼개거나 합쳐도 마이그레이션 없이
 * 이 배열만 고치면 된다.
 *
 * ⚠️ NOTICE 는 여기 없다. 운영 공지는 끄지 못하게 두었다 — 서비스 점검이나
 *    안전 안내처럼 못 보면 곤란한 것만 이 종류로 나간다. 서버는 NOTICE 도
 *    끌 수 있게 열려 있으니, 정책을 바꾸려면 여기 한 줄을 더하면 된다.
 */
export const NOTIFICATION_GROUPS: NotificationGroup[] = [
  {
    key: "MATCH_REQUEST",
    label: "매칭 신청",
    description: "우리 팀에 신청이 들어왔을 때",
    icon: "heart-outline",
    kinds: ["MATCH_REQUEST"],
  },
  {
    key: "MATCH_RESULT",
    label: "매칭 결과",
    description: "신청이 성사되거나 거절·취소됐을 때",
    icon: "chatbubbles-outline",
    kinds: ["MATCH_ACCEPTED", "MATCH_REJECTED", "MATCH_CANCELED"],
  },
  {
    key: "TEAM",
    label: "팀 소식",
    description: "팀원이 합류하거나 정원이 다 찼을 때",
    icon: "people-outline",
    kinds: ["TEAM_JOINED", "TEAM_READY"],
  },
  {
    key: "PLAN",
    label: "약속",
    description: "약속이 정해지거나 취소됐을 때",
    icon: "calendar-outline",
    kinds: ["PLAN_SET"],
  },
];

/**
 * 이 묶음이 켜져 있는가.
 *
 * 종류 하나라도 살아 있으면 켜짐으로 본다. 스위치는 늘 묶음 전체를 함께
 * 껐다 켜므로 보통은 전부 같은 상태지만, 어긋난 경우(설정 도중 끊김,
 * 종류가 늘어난 앱 버전) 사용자가 스위치를 한 번 내렸다 올리면 정리된다.
 */
export const isGroupEnabled = (
  group: NotificationGroup,
  mutedKinds: ReadonlySet<NotificationKind>,
): boolean => group.kinds.some((kind) => !mutedKinds.has(kind));

/** 푸시 payload 값은 무엇이든 올 수 있다. 문자열이 아니면 없는 셈 친다. */
const asId = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

export interface PushPayload {
  /** notifications.id — 눌렀을 때 읽음 표시에 쓴다 */
  notificationId?: string;
  target: NotificationTarget | null;
}

/**
 * 푸시 알림을 눌렀을 때 — 실려 온 data 로 갈 곳을 정한다.
 *
 * send-push Edge Function 이 실어 보내는 키(kind / teamId / matchId /
 * roomId / notificationId)를 그대로 읽는다. 목록에서 누를 때와 같은
 * notificationTarget 규칙을 타므로, 두 경로가 어긋날 일이 없다.
 */
export function readPushPayload(
  data: Record<string, unknown> | null | undefined,
): PushPayload {
  const kind = data?.kind;
  if (!data || typeof kind !== "string") {
    return { notificationId: undefined, target: null };
  }

  return {
    notificationId: asId(data.notificationId),
    target: notificationTarget({
      id: asId(data.notificationId) ?? "",
      kind: kind as NotificationKind,
      // 경로를 정하는 데는 쓰이지 않는다. 문구는 이미 알림에 떠 있다.
      title: "",
      body: "",
      teamId: asId(data.teamId),
      matchId: asId(data.matchId),
      roomId: asId(data.roomId),
      isRead: true,
      createdAt: "",
    }),
  };
}

export interface NotificationSection {
  title: string;
  data: AppNotification[];
}

const startOfToday = (): number => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
};

/**
 * 날짜별 묶음 — "오늘" / "이번 주" / "지난 알림".
 *
 * 목록은 이미 최신순으로 와 있다고 본다(서버 정렬). 여기서 다시 정렬하지
 * 않으므로 순서가 흐트러진 배열을 넣으면 그대로 흐트러진 채 묶인다.
 * 비어 있는 묶음은 만들지 않는다 — SectionList 가 제목만 덩그러니 그린다.
 */
export function groupNotifications(
  list: AppNotification[],
): NotificationSection[] {
  const today = startOfToday();
  const weekAgo = today - 6 * 86_400_000; // 오늘 포함 7일

  const buckets: NotificationSection[] = [
    { title: "오늘", data: [] },
    { title: "이번 주", data: [] },
    { title: "지난 알림", data: [] },
  ];

  for (const item of list) {
    const at = new Date(item.createdAt).getTime();
    if (at >= today) buckets[0].data.push(item);
    else if (at >= weekAgo) buckets[1].data.push(item);
    else buckets[2].data.push(item);
  }

  return buckets.filter((section) => section.data.length > 0);
}
