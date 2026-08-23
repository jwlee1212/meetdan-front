// 파일: app/chat/[id].tsx
import { Ionicons } from "@expo/vector-icons";
import * as Calendar from "expo-calendar";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  API,
  newMessageId,
  type ChatMessage,
  type ChatParticipant,
  // 이 화면의 컴포넌트 이름이 ChatRoom 이라 타입은 다른 이름으로 받는다
  type ChatRoom as ChatRoomInfo,
} from "@/api/client";
import { Badge } from "@/components/ui/badge";
import {
  BottomSheet,
  SheetAction,
  SheetCancel,
} from "@/components/ui/bottom-sheet";
import { PlanSheet } from "@/components/ui/plan-sheet";
import { PressScale } from "@/components/ui/press-scale";
import { ReportSheet } from "@/components/ui/report-sheet";
import { Divider, NavHeader } from "@/components/ui/screen";
import {
  Hairline,
  Palette,
  Radius,
  Shadow,
  Spacing,
  Typo,
} from "@/constants/theme";
import {
  ConfirmedPlan,
  Match,
  REPORT_REASONS,
  ReportReason,
  useStore,
} from "@/store/useStore";
import {
  dDayLabel,
  formatPlanSummary,
  isPastPlan,
  parsePlanDateTime,
} from "@/utils/plan";
import {
  PROFANITY_ALERT_MESSAGE,
  PROFANITY_ALERT_TITLE,
  hasProfanity,
} from "@/utils/profanity";

/* ------------------------------------------------------------------ */
/* 타입 / 상수                                                          */
/* ------------------------------------------------------------------ */

/**
 * 화면에 그리는 메시지.
 *
 * 서버 모양(ChatMessage)에 '내 것이냐'만 덧붙인 것이다. 같은 줄을 두 사람이
 * 서로 반대로 봐야 해서 그 판단은 서버가 아니라 여기서 한다.
 *
 * pending / failed 는 서버에 없는 값이다. 보내는 중인 말풍선을 먼저 그려두고
 * (낙관적 전송) 결과에 따라 지우거나 표시를 바꾼다.
 */
type ChatItem = ChatMessage & {
  mine: boolean;
  pending?: boolean;
  failed?: boolean;
  /** 차단·신고 결과처럼 나에게만 보여야 하는 안내. 서버로 가지 않는다. */
  localOnly?: boolean;
};

const REASON_LABEL = Object.fromEntries(
  REPORT_REASONS.map((r) => [r.value, r.label]),
) as Record<ReportReason, string>;

const DRAWER_WIDTH = Math.min(320, Dimensions.get("window").width * 0.84);

/** 한 번에 읽어오는 메시지 수. 서버 인덱스도 이 방향(최신순)으로 걸려 있다. */
const PAGE_SIZE = 50;

const formatTime = (iso: string) => {
  const d = new Date(iso);
  const h = d.getHours();
  const period = h < 12 ? "오전" : "오후";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${period} ${hour12}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

const dayLabel = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${DAY_NAMES[d.getDay()]}요일`;
};

const isSameDay = (a: string, b: string) => {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
};

/**
 * 메시지를 합친다. 항상 '최신이 배열 앞'으로 정렬한다(inverted FlatList).
 *
 * 같은 id 는 나중 것이 이긴다 — 낙관적으로 그려둔 내 말풍선이 Realtime 으로
 * 돌아온 진짜 행으로 덮여 사라지는 것도, 종료 제안 카드의 결정(UPDATE)이
 * 반영되는 것도 이 한 줄이 처리한다.
 *
 * 정렬은 문자열이 아니라 시각으로 비교한다. 서버가 주는 ISO 는
 * "...123456+00:00", 낙관적으로 만든 것은 "...123Z" 라 글자로 견주면
 * 같은 초 안에서 순서가 뒤집힌다.
 */
const mergeMessages = (prev: ChatItem[], incoming: ChatItem[]): ChatItem[] => {
  const byId = new Map(prev.map((m) => [m.id, m]));
  for (const message of incoming) byId.set(message.id, message);

  return [...byId.values()].sort((a, b) => {
    const diff = Date.parse(b.createdAt) - Date.parse(a.createdAt);
    return diff !== 0 ? diff : b.id.localeCompare(a.id);
  });
};

/* ------------------------------------------------------------------ */
/* 화면                                                                */
/* ------------------------------------------------------------------ */

export default function ChatRoom() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const {
    currentUser,
    matches,
    posts,
    myTeams,
    matchedTeams,
    blockedUsers,
    setBlockedUsers,
    blockUser,
    unblockUser,
    setConfirmedPlan,
    clearConfirmedPlan,
  } = useStore();

  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [participants, setParticipants] = useState<ChatParticipant[]>([]);
  const [room, setRoom] = useState<ChatRoomInfo | null>(null);
  /** 첫 화면을 그릴 만큼 읽어왔는가 */
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 더 읽어올 과거가 남아 있는가 */
  const [hasOlder, setHasOlder] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const [inputText, setInputText] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [planSheetOpen, setPlanSheetOpen] = useState(false);
  /** 점 세 개를 눌렀을 때 뜨는 액션 시트의 대상 */
  const [actionTarget, setActionTarget] = useState<ChatParticipant | null>(null);
  /** 신고 시트의 대상. 방 신고면 ROOM */
  const [reportTarget, setReportTarget] = useState<
    { type: "USER"; user: ChatParticipant } | { type: "ROOM" } | null
  >(null);

  const listRef = useRef<FlatList<ChatItem>>(null);

  // 키보드가 올라오면 홈 인디케이터 영역은 키보드에 가려진다.
  // 그때도 insets.bottom을 그대로 두면 입력창이 키보드 위로 붕 뜬다.
  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    const ios = Platform.OS === "ios";
    const show = Keyboard.addListener(
      ios ? "keyboardWillShow" : "keyboardDidShow",
      () => setKeyboardUp(true),
    );
    const hide = Keyboard.addListener(
      ios ? "keyboardWillHide" : "keyboardDidHide",
      () => setKeyboardUp(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // 시트가 닫히는 애니메이션 동안 내용이 비어버리지 않게 마지막 대상을 붙잡아 둔다
  const lastAction = useRef<ChatParticipant | null>(null);
  if (actionTarget) lastAction.current = actionTarget;
  const actionSheetUser = actionTarget ?? lastAction.current;

  const lastReport = useRef<typeof reportTarget>(null);
  if (reportTarget) lastReport.current = reportTarget;
  const reportSheetTarget = reportTarget ?? lastReport.current;

  /* ---------------- 매칭 / 방 ---------------- */

  // 경로의 id 는 매칭 id 다. 방 id(chat_rooms.id)는 아래에서 서버에 물어본다.
  const storeMatch = useMemo(
    () => matches.find((m) => m.id === id),
    [matches, id],
  );

  /**
   * 활동 탭을 거치지 않고 바로 들어온 경우(알림, 앱 재시작) 스토어가 비어 있다.
   * 그때만 매칭 한 줄을 직접 읽는다.
   */
  const [fetchedMatch, setFetchedMatch] = useState<Match | null>(null);
  const match = storeMatch ?? fetchedMatch;

  useEffect(() => {
    if (storeMatch || fetchedMatch) return;
    let alive = true;
    API.getMatch(String(id)).then((result) => {
      if (alive && result.code === 200 && result.data) {
        setFetchedMatch(result.data);
      }
    });
    return () => {
      alive = false;
    };
  }, [id, storeMatch, fetchedMatch]);

  const roomTitle = useMemo(() => {
    if (match) return match.partnerTeamName;
    const team = posts.find((p) => p.id.toString() === id);
    return team?.title ?? "대화 상대를 찾을 수 없음";
  }, [id, match, posts]);

  // 매칭에 묶인 실제 팀. 정원(3:3 표기)을 여기서 가져온다.
  // 매칭이 성사되면 게시판에서 내려가므로 보관함(matchedTeams)까지 본다.
  const findTeam = (teamId?: string) =>
    teamId === undefined || teamId === ""
      ? undefined
      : (posts.find((p) => p.id === teamId) ??
        myTeams.find((t) => t.id === teamId) ??
        matchedTeams.find((t) => t.id === teamId));

  const partnerTeam = findTeam(match?.partnerTeamId);
  const myTeam = findTeam(match?.myTeamId);

  const plan = match?.confirmedPlan;

  const blockedIds = useMemo(
    () => new Set(blockedUsers.map((b) => b.id)),
    [blockedUsers],
  );

  const partnerMembers = participants.filter((p) => p.team === "PARTNER");
  const myMembers = participants.filter((p) => p.team === "MINE");

  // "소웨 코딩 기계들 (3:3)" — 어느 팀과 몇 대 몇으로 만나는지 헤더에서 바로 보이게
  const headerTitle = match
    ? `${match.partnerTeamName} (${myTeam?.count ?? myMembers.length}:${
        partnerTeam?.count ?? partnerMembers.length
      })`
    : roomTitle;

  /* ---------------- 불러오기 ---------------- */

  /** 서버 모양에 '내 것이냐'만 덧붙인다. 같은 줄을 두 사람이 반대로 본다. */
  const toItem = useCallback(
    (message: ChatMessage): ChatItem => ({
      ...message,
      mine: !!message.senderId && message.senderId === currentUser?.id,
    }),
    [currentUser?.id],
  );

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setLoadError(null);

      // 방을 먼저 찾아야 메시지를 물어볼 수 있다(경로는 매칭 id 만 들고 온다)
      const roomResult = await API.getChatRoom(String(id));
      if (!alive) return;

      if (roomResult.code !== 200 || !roomResult.data) {
        setLoadError(roomResult.message ?? "채팅방을 열 수 없어요.");
        setLoading(false);
        return;
      }
      setRoom(roomResult.data);

      const [messageResult, participantResult, blockedResult] =
        await Promise.all([
          API.getChatMessages(roomResult.data.id, { limit: PAGE_SIZE }),
          API.getChatParticipants(String(id)),
          API.getBlockedUsers(),
        ]);
      if (!alive) return;

      if (messageResult.code === 200) {
        const rows = messageResult.data ?? [];
        setMessages(rows.map(toItem));
        setHasOlder(rows.length === PAGE_SIZE);
      } else {
        setLoadError(messageResult.message ?? "대화를 불러오지 못했어요.");
      }

      if (participantResult.code === 200) {
        setParticipants(participantResult.data ?? []);
      }

      // 차단 목록은 못 읽어도 대화는 열린다. 진짜 차단은 서버가 하고
      // (차단한 상대의 메시지는 아예 안 내려온다) 이 목록은 이미 그려진
      // 말풍선을 가리는 용도라서다.
      if (blockedResult.code === 200) {
        setBlockedUsers(blockedResult.data ?? []);
      }

      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [id, toItem, setBlockedUsers]);

  /**
   * 실시간 구독.
   *
   * INSERT 만 듣지 않는다. 종료 제안 카드의 결정은 그 메시지의 UPDATE 로
   * 찍히므로, 그걸 안 들으면 제안을 보낸 쪽 화면이 영영 대기 상태로 남는다.
   * 내가 보낸 메시지도 되돌아오지만 id 가 같아 낙관적 말풍선을 덮을 뿐이다.
   */
  useEffect(() => {
    if (!room) return;
    return API.subscribeToChatRoom(room.id, ({ message }) => {
      setMessages((prev) => mergeMessages(prev, [toItem(message)]));
    });
  }, [room, toItem]);

  /** 위로 스크롤해서 과거를 더 부른다 (inverted 리스트라 onEndReached 가 위쪽이다) */
  const loadOlder = useCallback(async () => {
    if (!room || loadingOlder || !hasOlder) return;

    // 로컬 안내(차단·신고)와 아직 못 보낸 말풍선은 서버에 없다.
    // 그걸 커서로 쓰면 클라이언트 시각을 기준으로 물어보게 되어 페이지가 어긋난다.
    const oldest = [...messages]
      .reverse()
      .find((m) => !m.localOnly && !m.pending && !m.failed);
    if (!oldest) return;

    setLoadingOlder(true);
    const result = await API.getChatMessages(room.id, {
      before: oldest.createdAt,
      limit: PAGE_SIZE,
    });

    if (result.code === 200) {
      const rows = result.data ?? [];
      setMessages((prev) => mergeMessages(prev, rows.map(toItem)));
      setHasOlder(rows.length === PAGE_SIZE);
    }
    setLoadingOlder(false);
  }, [room, loadingOlder, hasOlder, messages, toItem]);

  /**
   * 종료된 방인가.
   *
   * chat_rooms 는 Realtime 발행 대상이 아니라서 상대가 동의해도 방 행의
   * 변화는 안 내려온다. 대신 그 동의는 제안 메시지의 UPDATE 로 오므로
   * 그걸 함께 본다.
   */
  const roomClosed = useMemo(
    () =>
      !!room?.closedAt ||
      messages.some(
        (m) => m.kind === "proposal" && m.proposalResult === "ACCEPT",
      ),
    [room?.closedAt, messages],
  );

  /* ---------------- 메시지 ---------------- */

  /** 나에게만 보이는 안내. 차단·신고는 상대에게 알려선 안 된다. */
  const appendLocalNotice = (text: string) =>
    setMessages((prev) =>
      mergeMessages(prev, [
        {
          id: `local_${Date.now()}`,
          roomId: room?.id ?? "",
          senderId: null,
          kind: "system",
          text,
          isFiltered: false,
          createdAt: new Date().toISOString(),
          mine: false,
          localOnly: true,
        },
      ]),
    );

  /**
   * 낙관적으로 그려둔 말풍선 하나를 실제로 보낸다.
   * 실패해도 같은 id 로 다시 보내면 서버가 중복으로 넣지 않는다.
   */
  const deliver = async (roomId: string, messageId: string, text: string) => {
    const result = await API.sendChatMessage(roomId, text, messageId);

    if (result.code === 200 && result.data) {
      setMessages((prev) => mergeMessages(prev, [toItem(result.data!)]));
      return result.code;
    }

    // 422 = 금지어. 서버에는 아무것도 남지 않았으므로 말풍선을 지운다.
    if (result.code === 422) {
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
      Alert.alert(
        PROFANITY_ALERT_TITLE,
        result.message ?? PROFANITY_ALERT_MESSAGE,
      );
      return result.code;
    }

    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId ? { ...m, pending: false, failed: true } : m,
      ),
    );
    return result.code;
  };

  const sendMessage = async () => {
    const text = inputText.trim();
    if (!text || !room) return;

    if (roomClosed) {
      Alert.alert("종료된 채팅방이에요", "더 이상 메시지를 보낼 수 없어요.");
      return;
    }

    // 서버(filter-message)가 한 번 더 본다. 여기서 먼저 걸러 왕복을 아낄 뿐이다.
    if (hasProfanity(text)) {
      Alert.alert(PROFANITY_ALERT_TITLE, PROFANITY_ALERT_MESSAGE);
      return;
    }

    // id 를 먼저 만들어 두면 Realtime 으로 돌아온 진짜 행이 이 말풍선을
    // 그대로 덮는다. 임시 id 를 바꿔치기할 필요가 없다.
    const messageId = newMessageId();
    setMessages((prev) =>
      mergeMessages(prev, [
        {
          id: messageId,
          roomId: room.id,
          senderId: currentUser?.id ?? null,
          kind: "user",
          text,
          isFiltered: false,
          createdAt: new Date().toISOString(),
          mine: true,
          pending: true,
        },
      ]),
    );
    setInputText("");
    listRef.current?.scrollToOffset({ offset: 0, animated: true });

    const code = await deliver(room.id, messageId, text);
    // 금지어로 지워졌으면 고쳐 보낼 수 있게 입력값을 돌려준다
    if (code === 422) setInputText(text);
  };

  const retrySend = (item: ChatItem) => {
    if (!room) return;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === item.id ? { ...m, pending: true, failed: false } : m,
      ),
    );
    deliver(room.id, item.id, item.text);
  };

  const sendExitProposal = async () => {
    setDrawerOpen(false);
    if (!room) return;

    const result = await API.postExitProposal(room.id);
    if (result.code !== 200) {
      Alert.alert("오류", result.message ?? "종료 제안을 보내지 못했어요.");
    }
    // 카드 자체는 Realtime INSERT 로 양쪽에 함께 뜬다. 미리 그리지 않는다.
  };

  const handleProposalDecision = async (
    message: ChatItem,
    decision: "ACCEPT" | "REJECT",
  ) => {
    const result = await API.resolveExitProposal(message.id, decision);
    if (result.code !== 200) {
      Alert.alert("오류", result.message ?? "처리하지 못했어요.");
      return;
    }

    // 카드의 결정 표시는 Realtime UPDATE 로 양쪽에 반영된다.
    if (decision === "ACCEPT") {
      setRoom((prev) =>
        prev ? { ...prev, closedAt: new Date().toISOString() } : prev,
      );
      Alert.alert("채팅 종료", "양쪽의 동의로 채팅방이 종료되었어요.", [
        { text: "확인", onPress: () => router.replace("/(tabs)") },
      ]);
    }
  };

  /* ---------------- 약속 확정 ---------------- */

  /**
   * 약속은 matches 한 줄(plan_date/plan_time/plan_place)에 저장된다.
   * 서버에 먼저 쓰고 화면을 고친다 — 반대로 하면 실패했을 때 나에게만
   * 보이는 약속이 남고, 활동 탭이 다시 읽는 순간 조용히 사라진다.
   *
   * match 가 없는 방(예전 경로로 팀 id 를 들고 들어온 경우)은 서버에
   * 쓸 대상이 없으므로 예전처럼 화면에만 남긴다.
   */
  const handleSavePlan = async (next: ConfirmedPlan) => {
    if (match) {
      const result = await API.setMatchPlan(match.id, next);
      if (result.code !== 200) {
        Alert.alert("오류", result.message ?? "약속을 저장하지 못했어요.");
        return;
      }
    }

    setConfirmedPlan(String(id), next, roomTitle);
    setFetchedMatch((prev) => (prev ? { ...prev, confirmedPlan: next } : prev));
    setPlanSheetOpen(false);

    // 약속 안내는 양쪽에 남아야 한다. 화면 state 에만 쌓으면 나에게만 보인다.
    if (room) {
      await API.postSystemMessage(
        room.id,
        `${plan ? "약속이 변경되었어요." : "약속이 확정되었어요."}\n${formatPlanSummary(next)}`,
      );
    }
  };

  const handleRemovePlan = async () => {
    if (match) {
      const result = await API.clearMatchPlan(match.id);
      if (result.code !== 200) {
        Alert.alert("오류", result.message ?? "약속을 취소하지 못했어요.");
        return;
      }
    }

    clearConfirmedPlan(String(id));
    setFetchedMatch((prev) =>
      prev ? { ...prev, confirmedPlan: undefined } : prev,
    );
    setPlanSheetOpen(false);

    if (room) await API.postSystemMessage(room.id, "확정된 약속을 취소했어요.");
  };

  /** 기기에 쓸 수 있는 캘린더 하나를 고른다. (iOS 기본 캘린더 → 수정 가능한 것 순) */
  const resolveCalendarId = async () => {
    if (Platform.OS === "ios") {
      try {
        const def = await Calendar.getDefaultCalendarAsync();
        if (def?.id) return def.id;
      } catch {
        // 기본 캘린더가 없는 기기도 있다. 아래 목록에서 찾아본다.
      }
    }
    const calendars = await Calendar.getCalendarsAsync(
      Calendar.EntityTypes.EVENT,
    );
    const writable = calendars.find((c) => c.allowsModifications);
    return writable?.id ?? null;
  };

  const addPlanToCalendar = async () => {
    if (!plan) return;

    if (Platform.OS === "web") {
      Alert.alert(
        "휴대폰에서 사용할 수 있어요",
        "캘린더 저장은 밋단 앱에서만 지원해요.",
      );
      return;
    }

    try {
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "캘린더 권한이 필요해요",
          "설정 > 밋단에서 캘린더 접근을 허용하면 일정을 저장할 수 있어요.",
        );
        return;
      }

      const calendarId = await resolveCalendarId();
      if (!calendarId) {
        Alert.alert(
          "저장할 캘린더가 없어요",
          "기기 캘린더 앱에서 캘린더를 하나 만든 뒤 다시 시도해주세요.",
        );
        return;
      }

      const startDate = parsePlanDateTime(plan);
      const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);

      await Calendar.createEventAsync(calendarId, {
        title: `밋단 미팅 · ${roomTitle}`,
        startDate,
        endDate,
        location: plan.place || undefined,
        notes: "밋단에서 확정한 약속이에요.",
        // 하루 전, 한 시간 전 두 번 알려줘야 진짜 안 깜빡한다
        alarms: [{ relativeOffset: -60 * 24 }, { relativeOffset: -60 }],
      });

      Alert.alert(
        "캘린더에 저장했어요",
        "약속 하루 전과 한 시간 전에 알림이 울려요.",
      );
    } catch {
      Alert.alert(
        "저장하지 못했어요",
        "잠시 후 다시 시도해주세요. 계속 실패하면 캘린더 권한을 확인해주세요.",
      );
    }
  };

  /* ---------------- 신고 / 차단 ---------------- */

  // iOS는 시트가 완전히 닫히기 전에 다른 시트를 띄우면 무시된다
  const afterSheetClose = (fn: () => void) =>
    setTimeout(fn, Platform.OS === "ios" ? 350 : 0);

  const openReportForUser = (user: ChatParticipant) => {
    setActionTarget(null);
    afterSheetClose(() => setReportTarget({ type: "USER", user }));
  };

  const openReportForRoom = () => {
    setDrawerOpen(false);
    setReportTarget({ type: "ROOM" });
  };

  /**
   * 차단은 서버에 먼저 쓴다. 성공해야 화면과 스토어를 고친다 —
   * 반대로 하면 실패했을 때 '차단한 줄 알았는데 상대 메시지가 계속 오는'
   * 상태가 된다. 차단·해제 안내는 나에게만 보이는 로컬 메시지다
   * (상대에게 "내가 차단당했다"를 알려선 안 된다).
   */
  const applyBlock = async (user: ChatParticipant) => {
    const result = await API.blockUser({
      id: user.id,
      name: user.name,
      dept: user.dept,
      roomId: room?.id,
    });

    if (result.code !== 200) {
      Alert.alert("오류", result.message ?? "차단하지 못했어요.");
      return false;
    }

    blockUser({
      id: user.id,
      name: user.name,
      dept: user.dept,
      roomId: room?.id,
    });
    return true;
  };

  const confirmBlock = (user: ChatParticipant) => {
    setActionTarget(null);
    afterSheetClose(() =>
      Alert.alert(
        `${user.name} 님을 차단할까요?`,
        "차단하면 이 사용자의 메시지가 보이지 않고, 앞으로 매칭에서도 만나지 않아요.",
        [
          { text: "취소", style: "cancel" },
          {
            text: "차단하기",
            style: "destructive",
            onPress: async () => {
              if (await applyBlock(user)) {
                appendLocalNotice(`${user.name} 님을 차단했어요.`);
              }
            },
          },
        ],
      ),
    );
  };

  const handleUnblock = async (user: ChatParticipant) => {
    setActionTarget(null);

    const result = await API.unblockUser(user.id);
    if (result.code !== 200) {
      Alert.alert("오류", result.message ?? "차단을 해제하지 못했어요.");
      return;
    }

    unblockUser(user.id);
    appendLocalNotice(`${user.name} 님의 차단을 해제했어요.`);

    // 차단 동안 서버가 걸러낸 메시지는 화면에도 없다. 다시 읽어와야 보인다.
    if (room) {
      const refreshed = await API.getChatMessages(room.id, {
        limit: PAGE_SIZE,
      });
      if (refreshed.code === 200) {
        setMessages((prev) => mergeMessages(prev, (refreshed.data ?? []).map(toItem)));
      }
    }
  };

  const handleReportSubmit = async ({
    reason,
    detail,
    alsoBlock,
  }: {
    reason: ReportReason;
    detail: string;
    alsoBlock: boolean;
  }) => {
    if (!reportTarget || !room) return;

    const isUser = reportTarget.type === "USER";
    const targetName = isUser ? reportTarget.user.name : roomTitle;

    // 방 신고의 대상은 매칭이 아니라 채팅방이다(reports.room_id 는 chat_rooms 참조)
    const result = await API.submitReport({
      targetType: isUser ? "USER" : "ROOM",
      targetId: isUser ? reportTarget.user.id : room.id,
      reason,
      detail,
      roomId: room.id,
    });

    const blocked =
      isUser && alsoBlock && result.code === 200
        ? await applyBlock(reportTarget.user)
        : false;

    setReportTarget(null);

    afterSheetClose(() => {
      if (result.code === 409) {
        Alert.alert("이미 접수된 신고예요", result.message!);
        return;
      }
      if (result.code !== 200) {
        Alert.alert("오류", result.message ?? "신고를 접수하지 못했어요.");
        return;
      }

      appendLocalNotice(
        `${targetName} 신고가 접수되었어요. (사유: ${REASON_LABEL[reason]})` +
          (blocked ? `\n${targetName} 님을 차단했어요.` : ""),
      );
      Alert.alert(
        "신고가 접수되었어요",
        "운영팀이 24시간 안에 확인하고 조치할게요.\n확인 결과는 알림으로 알려드립니다.",
      );
    });
  };

  /* ---------------- 렌더 ---------------- */

  const renderItem = ({ item, index }: { item: ChatItem; index: number }) => {
    // inverted 리스트라 배열 앞이 화면 아래다. 위에 붙는 이웃은 index + 1.
    const older = messages[index + 1];
    const newer = messages[index - 1];

    // 날짜가 바뀌는 지점에만 구분선을 넣는다. 가장 오래된 줄 위에는 항상.
    const dateDivider = (!older || !isSameDay(older.createdAt, item.createdAt)) && (
      <View style={styles.dateRow}>
        <Text style={styles.dateText}>{dayLabel(item.createdAt)}</Text>
      </View>
    );

    if (item.kind === "proposal") {
      return (
        <View>
          {dateDivider}
          <ProposalCard
            result={item.proposalResult}
            onDecide={(decision) => handleProposalDecision(item, decision)}
          />
        </View>
      );
    }

    if (item.kind === "system") {
      return (
        <View>
          {dateDivider}
          <View style={styles.systemRow}>
            <Text style={styles.systemText}>{item.text}</Text>
          </View>
        </View>
      );
    }

    const isMe = item.mine;

    // 같은 사람이 연달아 보낸 말풍선은 이름·시간을 한 번만 보여준다
    const sameAsPrev =
      !!older && older.kind === "user" && older.senderId === item.senderId;
    const sameAsNext =
      !!newer && newer.kind === "user" && newer.senderId === item.senderId;
    const showHeader = !isMe && (!sameAsPrev || !!dateDivider);
    const showTime =
      !sameAsNext || formatTime(newer.createdAt) !== formatTime(item.createdAt);

    const sender = participants.find((p) => p.id === item.senderId);
    const isBlockedSender = !!item.senderId && blockedIds.has(item.senderId);

    return (
      <View
        style={[
          styles.messageBlock,
          sameAsPrev && !dateDivider && styles.messageBlockTight,
        ]}
      >
        {dateDivider}

        {showHeader && !!sender && (
          <Text style={styles.senderName}>
            {sender.name}
            {sender.isLeader ? " · 팀장" : ""}
          </Text>
        )}

        <View style={[styles.bubbleRow, isMe && styles.bubbleRowMine]}>
          {!isMe && (
            <View style={styles.avatarSlot}>
              {showHeader && (
                <View
                  style={[styles.avatar, isBlockedSender && styles.avatarMuted]}
                >
                  <Text style={styles.avatarText}>
                    {sender?.name.charAt(0) ?? "?"}
                  </Text>
                </View>
              )}
            </View>
          )}

          {/*
            말풍선과 시각을 세로로 쌓는다. 한 줄에 나란히 두면 시각이 가로
            공간을 가져가서 그만큼 말풍선이 좁아진다(글자가 일찍 줄바꿈된다).
          */}
          <View style={[styles.bubbleColumn, isMe && styles.bubbleColumnMine]}>
            {isBlockedSender ? (
              <View style={styles.blockedBubble}>
                <Ionicons
                  name="eye-off-outline"
                  size={14}
                  color={Palette.gray500}
                />
                <Text style={styles.blockedText}>
                  차단한 사용자의 메시지예요
                </Text>
              </View>
            ) : (
              <Pressable
                // 보내다 실패한 말풍선은 눌러서 다시 보낸다.
                onPress={item.failed ? () => retrySend(item) : undefined}
                onLongPress={() => sender && setActionTarget(sender)}
                delayLongPress={300}
                disabled={isMe && !item.failed}
                style={({ pressed }) => [
                  styles.bubble,
                  isMe ? styles.myBubble : styles.theirBubble,
                  showHeader && !isMe && styles.theirBubbleFirst,
                  isMe && !sameAsPrev && styles.myBubbleFirst,
                  item.pending && styles.bubblePending,
                  item.failed && styles.bubbleFailed,
                  pressed && (!isMe || item.failed) && { opacity: 0.85 },
                ]}
              >
                <Text style={[styles.bubbleText, isMe && styles.myBubbleText]}>
                  {item.text}
                </Text>
              </Pressable>
            )}

            {item.failed ? (
              <Text style={styles.failedText}>전송 실패 · 눌러서 재시도</Text>
            ) : (
              showTime &&
              !item.pending && (
                <Text style={styles.timeText}>{formatTime(item.createdAt)}</Text>
              )
            )}
          </View>
        </View>
      </View>
    );
  };

  const canSend = inputText.trim().length > 0 && !!room && !roomClosed;

  // 둘 중 하나만 바뀌어도 목록을 다시 그려야 한다 (renderItem 이 이웃을 본다)
  const listExtraData = useMemo(
    () => ({ messages, blockedIds }),
    [messages, blockedIds],
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <NavHeader
        title={headerTitle}
        subtitle={`${participants.length}명 참여 중`}
        onBack={() => router.back()}
        right={
          <Pressable
            hitSlop={8}
            onPress={() => setDrawerOpen(true)}
            style={({ pressed }) => [
              styles.headerButton,
              pressed && { opacity: 0.5 },
            ]}
          >
            <Ionicons
              name="ellipsis-vertical"
              size={20}
              color={Palette.gray800}
            />
          </Pressable>
        }
      />

      {/* 확정된 약속은 스크롤과 무관하게 항상 보여야 한다 */}
      {!!plan && (
        <PlanBanner
          plan={plan}
          onEdit={() => setPlanSheetOpen(true)}
          onAddCalendar={addPlanToCalendar}
        />
      )}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        // 이 뷰의 layout y는 이미 화면 최상단 기준(루트 View가 전체 화면)이라
        // 헤더 높이를 오프셋으로 더하면 그만큼 입력창이 키보드에서 떨어진다.
        keyboardVerticalOffset={0}
      >
        {loading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator color={Palette.brand} />
          </View>
        ) : loadError ? (
          <View style={styles.centerBox}>
            <Ionicons
              name="chatbubble-ellipses-outline"
              size={32}
              color={Palette.gray300}
            />
            <Text style={styles.centerText}>{loadError}</Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            // 최신이 배열 앞이고, inverted 가 그걸 화면 아래로 뒤집는다.
            // 새 메시지가 와도 스크롤을 건드릴 필요가 없고, 과거 불러오기는
            // onEndReached(= 위로 끝까지) 하나로 끝난다.
            inverted
            data={messages}
            renderItem={renderItem}
            keyExtractor={(item) => item.id}
            /*
             * 각 줄이 위아래 이웃을 보고 그려진다(이름·시각을 언제 보여줄지).
             * 새 메시지가 들어오면 그 위 줄의 판단도 바뀌므로 목록 전체가 다시
             * 그려져야 한다. 차단도 마찬가지 — 이미 그려진 말풍선이 즉시 가려져야 한다.
             */
            extraData={listExtraData}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            keyboardDismissMode="on-drag"
            onEndReached={loadOlder}
            onEndReachedThreshold={0.4}
            ListFooterComponent={
              loadingOlder ? (
                <View style={styles.olderSpinner}>
                  <ActivityIndicator size="small" color={Palette.gray400} />
                </View>
              ) : null
            }
            ListEmptyComponent={
              <View style={[styles.centerBox, styles.emptyFlip]}>
                <Text style={styles.centerText}>
                  매칭이 성사되었어요! 🎉{"\n"}먼저 인사를 건네보세요.
                </Text>
              </View>
            }
          />
        )}

        {roomClosed ? (
          <View
            style={[
              styles.closedBar,
              { paddingBottom: Math.max(insets.bottom, Spacing.md) },
            ]}
          >
            <Ionicons
              name="lock-closed-outline"
              size={16}
              color={Palette.gray500}
            />
            <Text style={styles.closedText}>
              종료된 채팅방이에요. 지난 대화는 계속 볼 수 있어요.
            </Text>
          </View>
        ) : (
          <View
            style={[
              styles.inputBar,
              {
                paddingBottom: keyboardUp
                  ? Spacing.md
                  : Math.max(insets.bottom, Spacing.md),
              },
            ]}
          >
            <TextInput
              style={styles.input}
              value={inputText}
              onChangeText={setInputText}
              placeholder="메시지 보내기"
              placeholderTextColor={Palette.gray400}
              multiline
              returnKeyType="send"
              onSubmitEditing={sendMessage}
              blurOnSubmit={false}
              editable={!!room}
            />

            {/* 대화 내용과 무관하게 언제든 약속을 잡을 수 있게 상시 노출 */}
            <Pressable
              onPress={() => setPlanSheetOpen(true)}
              accessibilityLabel="약속 잡기"
              style={({ pressed }) => [
                styles.planButton,
                !!plan && styles.planButtonActive,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Ionicons
                name={plan ? "calendar" : "calendar-outline"}
                size={20}
                color={plan ? Palette.brand : Palette.gray600}
              />
            </Pressable>

            <Pressable
              onPress={sendMessage}
              disabled={!canSend}
              style={({ pressed }) => [
                styles.sendButton,
                !canSend && styles.sendButtonOff,
                pressed && canSend && { opacity: 0.85 },
              ]}
            >
              <Ionicons
                name="arrow-up"
                size={20}
                color={canSend ? Palette.white : Palette.gray400}
              />
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>

      <ChatDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        roomTitle={roomTitle}
        myMembers={myMembers}
        partnerMembers={partnerMembers}
        blockedIds={blockedIds}
        roomClosed={roomClosed}
        onPressMember={setActionTarget}
        onReportRoom={openReportForRoom}
        onManageBlocked={() => {
          setDrawerOpen(false);
          router.push("/settings/blocked" as any);
        }}
        onExitProposal={() =>
          Alert.alert(
            "채팅 종료를 제안할까요?",
            "상대 팀장이 동의하면 채팅방이 사라져요.",
            [
              { text: "취소", style: "cancel" },
              {
                text: "제안하기",
                style: "destructive",
                onPress: sendExitProposal,
              },
            ],
          )
        }
      />

      {/* 참여자 액션 시트 */}
      <BottomSheet
        visible={!!actionTarget}
        onClose={() => setActionTarget(null)}
        title={actionSheetUser?.name}
        description={
          actionSheetUser
            ? `${actionSheetUser.dept} · ${
                actionSheetUser.team === "MINE" ? "우리 팀" : "상대 팀"
              }`
            : undefined
        }
      >
        {!!actionSheetUser && actionSheetUser.team === "PARTNER" && (
          <View style={styles.sheetBody}>
            <SheetAction
              icon="flag-outline"
              label="신고하기"
              description="부적절한 대화나 행동을 운영팀에 알려요"
              tone="danger"
              onPress={() => openReportForUser(actionSheetUser)}
            />
            {blockedIds.has(actionSheetUser.id) ? (
              <SheetAction
                icon="eye-outline"
                label="차단 해제"
                description="이 사용자의 메시지를 다시 볼 수 있어요"
                onPress={() => handleUnblock(actionSheetUser)}
              />
            ) : (
              <SheetAction
                icon="ban-outline"
                label="차단하기"
                description="메시지를 숨기고 다시 매칭되지 않아요"
                tone="danger"
                onPress={() => confirmBlock(actionSheetUser)}
              />
            )}
            <SheetCancel onPress={() => setActionTarget(null)} />
          </View>
        )}

        {!!actionSheetUser && actionSheetUser.team === "MINE" && (
          <View style={styles.sheetBody}>
            <Text style={styles.sheetNotice}>
              우리 팀원은 신고·차단할 수 없어요.
            </Text>
            <SheetCancel onPress={() => setActionTarget(null)} />
          </View>
        )}
      </BottomSheet>

      {/* 약속 잡기 시트 */}
      <PlanSheet
        visible={planSheetOpen}
        onClose={() => setPlanSheetOpen(false)}
        initialPlan={plan}
        onSubmit={handleSavePlan}
        onRemove={handleRemovePlan}
      />

      {/* 신고 시트 */}
      <ReportSheet
        visible={!!reportTarget}
        onClose={() => setReportTarget(null)}
        targetType={reportSheetTarget?.type ?? "USER"}
        targetName={
          reportSheetTarget?.type === "USER"
            ? reportSheetTarget.user.name
            : roomTitle
        }
        canBlock={reportSheetTarget?.type === "USER"}
        onSubmit={handleReportSubmit}
      />
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* 확정 약속 배너                                                       */
/* ------------------------------------------------------------------ */

function PlanBanner({
  plan,
  onEdit,
  onAddCalendar,
}: {
  plan: ConfirmedPlan;
  onEdit: () => void;
  onAddCalendar: () => void;
}) {
  const past = isPastPlan(plan.date);

  return (
    <View style={[styles.banner, past && styles.bannerPast]}>
      <Pressable
        onPress={onEdit}
        style={({ pressed }) => [styles.bannerRow, pressed && { opacity: 0.7 }]}
      >
        <View style={[styles.bannerIcon, past && styles.bannerIconPast]}>
          <Ionicons
            name={past ? "checkmark-done" : "calendar"}
            size={18}
            color={past ? Palette.gray500 : Palette.brand}
          />
        </View>

        <View style={styles.bannerText}>
          <Text style={styles.bannerLabel}>
            {past ? "지난 약속" : "확정된 약속"}
          </Text>
          <Text style={styles.bannerValue} numberOfLines={1}>
            {formatPlanSummary(plan)}
          </Text>
        </View>

        <Badge
          label={past ? "만남 완료" : dDayLabel(plan.date)}
          tone={past ? "neutral" : "solid"}
        />
        <Ionicons name="chevron-forward" size={16} color={Palette.gray400} />
      </Pressable>

      {!past && (
        <View style={styles.bannerCta}>
          <Text style={styles.bannerCtaText} numberOfLines={1}>
            깜빡하지 않게 캘린더에 저장해두세요
          </Text>
          <PressScale
            scaleTo={0.95}
            style={styles.calendarButton}
            onPress={onAddCalendar}
          >
            <Ionicons name="add" size={14} color={Palette.white} />
            <Text style={styles.calendarButtonText}>캘린더에 추가</Text>
          </PressScale>
        </View>
      )}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* 종료 제안 카드                                                       */
/* ------------------------------------------------------------------ */

/**
 * 이미 답한 제안은 결과만 남긴다. 답은 서버(messages.proposal_result)에
 * 저장되고 Realtime UPDATE 로 양쪽 화면에 함께 반영된다.
 *
 * ⚠️ 제안에는 보낸 사람이 없다(kind='proposal' 은 sender_id 가 null).
 *    그래서 제안한 쪽 화면에도 같은 버튼이 보인다.
 */
function ProposalCard({
  result,
  onDecide,
}: {
  result?: "ACCEPT" | "REJECT";
  onDecide: (d: "ACCEPT" | "REJECT") => void;
}) {
  return (
    <View style={styles.proposalWrap}>
      <View style={styles.proposalCard}>
        <View style={styles.proposalIcon}>
          <Ionicons name="exit-outline" size={20} color={Palette.red} />
        </View>
        <Text style={styles.proposalTitle}>채팅 종료 제안</Text>
        <Text style={styles.proposalText}>
          대화 종료가 제안되었어요.{"\n"}동의하면 채팅방이 사라져요.
        </Text>

        {result ? (
          <Text style={styles.proposalResult}>
            {result === "ACCEPT"
              ? "동의로 채팅이 종료되었어요."
              : "더 대화하기로 했어요."}
          </Text>
        ) : (
          <View style={styles.proposalButtons}>
            <Pressable
              style={({ pressed }) => [
                styles.proposalBtn,
                styles.proposalReject,
                pressed && { opacity: 0.7 },
              ]}
              onPress={() => onDecide("REJECT")}
            >
              <Text style={styles.proposalRejectText}>더 대화할래요</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.proposalBtn,
                styles.proposalAccept,
                pressed && { opacity: 0.85 },
              ]}
              onPress={() => onDecide("ACCEPT")}
            >
              <Text style={styles.proposalAcceptText}>동의</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* 오른쪽 서랍                                                          */
/* ------------------------------------------------------------------ */

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  roomTitle: string;
  myMembers: ChatParticipant[];
  partnerMembers: ChatParticipant[];
  blockedIds: Set<string>;
  /** 종료된 방에서는 다시 종료를 제안할 수 없다 */
  roomClosed: boolean;
  onPressMember: (p: ChatParticipant) => void;
  onReportRoom: () => void;
  onManageBlocked: () => void;
  onExitProposal: () => void;
}

function ChatDrawer({
  open,
  onClose,
  roomTitle,
  myMembers,
  partnerMembers,
  blockedIds,
  roomClosed,
  onPressMember,
  onReportRoom,
  onManageBlocked,
  onExitProposal,
}: DrawerProps) {
  const insets = useSafeAreaInsets();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [open, progress]);

  // Modal 대신 화면 안에 겹쳐 그린다. 시트(Modal)와 겹칠 때 iOS에서
  // 모달이 서로를 가리는 문제를 피할 수 있고, 슬라이드도 자연스럽다.
  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [DRAWER_WIDTH, 0],
  });

  const renderMember = (p: ChatParticipant, actionable: boolean) => {
    const blocked = blockedIds.has(p.id);
    return (
      <Pressable
        key={p.id}
        disabled={!actionable}
        onPress={() => onPressMember(p)}
        style={({ pressed }) => [
          styles.memberRow,
          pressed && actionable && { backgroundColor: Palette.gray50 },
        ]}
      >
        <View style={[styles.memberAvatar, blocked && styles.avatarMuted]}>
          <Text style={styles.memberAvatarText}>{p.name.charAt(0)}</Text>
        </View>
        <View style={styles.memberText}>
          <View style={styles.memberNameRow}>
            <Text style={styles.memberName} numberOfLines={1}>
              {p.name}
            </Text>
            {p.isLeader && <Badge label="팀장" tone="brand" />}
            {blocked && <Badge label="차단됨" tone="danger" />}
          </View>
          <Text style={styles.memberDept} numberOfLines={1}>
            {p.dept}
          </Text>
        </View>
        {actionable && (
          <Ionicons
            name="ellipsis-horizontal"
            size={18}
            color={Palette.gray400}
          />
        )}
      </Pressable>
    );
  };

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents={open ? "auto" : "none"}
    >
      <Animated.View style={[styles.drawerBackdrop, { opacity: progress }]}>
        <Pressable style={styles.flex} onPress={onClose} />
      </Animated.View>

      <Animated.View
        style={[
          styles.drawer,
          { paddingTop: insets.top + Spacing.sm, transform: [{ translateX }] },
        ]}
      >
        <View style={styles.drawerHeader}>
          <Text style={styles.drawerTitle}>채팅방 정보</Text>
          <Pressable hitSlop={8} onPress={onClose} style={styles.headerButton}>
            <Ionicons name="close" size={22} color={Palette.gray700} />
          </Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.roomCard}>
            <Text style={styles.roomName} numberOfLines={1}>
              {roomTitle}
            </Text>
            <Badge
              label={roomClosed ? "종료된 채팅" : "매칭 진행 중"}
              tone={roomClosed ? "neutral" : "success"}
            />
          </View>

          <Text style={styles.drawerSection}>
            상대 팀 ({partnerMembers.length})
          </Text>
          {partnerMembers.map((p) => renderMember(p, true))}

          <Divider />

          <Text style={styles.drawerSection}>우리 팀 ({myMembers.length})</Text>
          {myMembers.map((p) => renderMember(p, false))}

          <Divider />

          <Text style={styles.drawerSection}>안전</Text>
          <DrawerLink
            icon="flag-outline"
            label="채팅방 신고"
            onPress={onReportRoom}
          />
          <DrawerLink
            icon="ban-outline"
            label="차단 목록 관리"
            onPress={onManageBlocked}
          />
        </ScrollView>

        <View
          style={[
            styles.drawerFooter,
            { paddingBottom: insets.bottom + Spacing.lg },
          ]}
        >
          {!roomClosed && (
            <PressScale
              scaleTo={0.97}
              style={styles.exitButton}
              onPress={onExitProposal}
            >
              <Ionicons name="log-out-outline" size={18} color={Palette.red} />
              <Text style={styles.exitButtonText}>채팅방 종료 제안</Text>
            </PressScale>
          )}
        </View>
      </Animated.View>
    </View>
  );
}

function DrawerLink({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.drawerLink,
        pressed && { backgroundColor: Palette.gray50 },
      ]}
    >
      <Ionicons name={icon} size={20} color={Palette.gray600} />
      <Text style={styles.drawerLinkText}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={Palette.gray300} />
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* 스타일                                                              */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Palette.white },
  flex: { flex: 1 },
  headerButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },

  // 확정 약속 배너
  banner: {
    backgroundColor: Palette.brandWeak,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
    borderBottomWidth: Hairline.height,
    borderBottomColor: Palette.gray200,
  },
  bannerPast: { backgroundColor: Palette.gray100 },
  bannerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  bannerIcon: {
    width: 34,
    height: 34,
    borderRadius: Radius.full,
    backgroundColor: Palette.white,
    alignItems: "center",
    justifyContent: "center",
  },
  bannerIconPast: { backgroundColor: Palette.gray200 },
  bannerText: { flex: 1 },
  bannerLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: -0.2,
    color: Palette.brandText,
  },
  bannerValue: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: Palette.gray900,
    marginTop: 2,
  },
  bannerCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: Hairline.height,
    borderTopColor: Palette.gray200,
  },
  bannerCtaText: {
    ...Typo.caption,
    flex: 1,
    fontSize: 12,
    color: Palette.gray600,
  },
  calendarButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingLeft: Spacing.md,
    paddingRight: 14,
    paddingVertical: 8,
    borderRadius: Radius.full,
    backgroundColor: Palette.brand,
  },
  calendarButtonText: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: Palette.white,
  },

  list: { flex: 1, backgroundColor: Palette.gray50 },
  // inverted 리스트라 위아래가 뒤집힌다. paddingTop 이 화면 아래에 붙으므로
  // 예전과 같은 여백을 얻으려면 두 값을 서로 바꿔 둬야 한다.
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.md,
  },

  centerBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.md,
    padding: Spacing.xl,
    backgroundColor: Palette.gray50,
  },
  /**
   * inverted 리스트는 목록 전체를 뒤집어 그린다. 각 줄은 다시 뒤집혀
   * 제대로 보이지만 ListEmptyComponent 는 그 보정을 받지 못해 글자가
   * 거꾸로 선다. 그 자리에만 한 번 더 뒤집어 준다.
   */
  emptyFlip: { transform: [{ scaleY: -1 }] },
  centerText: {
    ...Typo.caption,
    fontSize: 13,
    color: Palette.gray500,
    textAlign: "center",
    lineHeight: 20,
  },
  olderSpinner: { paddingVertical: Spacing.lg, alignItems: "center" },

  closedBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    backgroundColor: Palette.gray100,
    borderTopWidth: Hairline.height,
    borderTopColor: Palette.gray200,
  },
  closedText: { ...Typo.caption, fontSize: 12, color: Palette.gray600 },

  dateRow: {
    alignItems: "center",
    marginTop: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  dateText: {
    ...Typo.caption,
    fontSize: 12,
    color: Palette.gray500,
    backgroundColor: Palette.gray100,
    paddingHorizontal: Spacing.md,
    paddingVertical: 5,
    borderRadius: Radius.full,
    overflow: "hidden",
  },

  systemRow: { alignItems: "center", marginVertical: Spacing.md },
  systemText: {
    ...Typo.caption,
    fontSize: 12,
    color: Palette.gray600,
    textAlign: "center",
    lineHeight: 18,
    backgroundColor: Palette.gray100,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
    overflow: "hidden",
    maxWidth: "88%",
  },

  messageBlock: { marginTop: Spacing.lg },
  messageBlockTight: { marginTop: Spacing.xs },
  senderName: {
    ...Typo.caption,
    fontSize: 12,
    color: Palette.gray600,
    marginLeft: 44,
    marginBottom: 4,
  },

  /**
   * 아바타 | (말풍선 + 시각) 두 칸짜리 행.
   *
   * flex-start 인 이유: 아바타는 말풍선 묶음의 첫 줄 옆에 서야 한다.
   * flex-end 로 두면 아래에 붙은 시각만큼 아바타가 같이 내려간다.
   * 말풍선 꼬리(theirBubbleFirst)도 위쪽 모서리라 위 정렬이 맞다.
   */
  bubbleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  bubbleRowMine: { justifyContent: "flex-end" },

  // 폭 제한은 말풍선이 아니라 이 칸이 진다. 시각도 같은 폭 안에 놓인다.
  bubbleColumn: { maxWidth: "72%", alignItems: "flex-start" },
  bubbleColumnMine: { alignItems: "flex-end" },

  avatarSlot: { width: 36, marginRight: Spacing.sm },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    backgroundColor: Palette.brandWeak,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarMuted: { backgroundColor: Palette.gray200 },
  avatarText: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: Palette.brandText,
  },

  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: Radius.lg,
  },
  theirBubble: {
    backgroundColor: Palette.white,
    borderWidth: Hairline.height,
    borderColor: Palette.gray200,
  },
  theirBubbleFirst: { borderTopLeftRadius: 6 },
  myBubble: { backgroundColor: Palette.brand },
  myBubbleFirst: { borderTopRightRadius: 6 },
  bubbleText: {
    fontSize: 15,
    lineHeight: 21,
    letterSpacing: -0.3,
    color: Palette.gray900,
  },
  myBubbleText: { color: Palette.white },
  /** 보내는 중 — 서버가 받았다는 답이 오면 원래 색으로 돌아온다 */
  bubblePending: { opacity: 0.6 },
  bubbleFailed: { backgroundColor: Palette.gray400 },

  blockedBubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: Radius.lg,
    backgroundColor: Palette.gray100,
  },
  blockedText: {
    fontSize: 13,
    letterSpacing: -0.3,
    color: Palette.gray500,
  },

  // 말풍선 아래에 붙는다. marginHorizontal 은 말풍선 모서리와 붙지 않게.
  timeText: {
    fontSize: 11,
    color: Palette.gray400,
    marginTop: 3,
    marginHorizontal: 4,
  },
  failedText: {
    fontSize: 11,
    color: Palette.red,
    marginTop: 3,
    marginHorizontal: 4,
  },

  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    backgroundColor: Palette.white,
    borderTopWidth: Hairline.height,
    borderTopColor: Hairline.color,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: Radius.xl,
    backgroundColor: Palette.gray100,
    paddingHorizontal: Spacing.lg,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 15,
    letterSpacing: -0.3,
    color: Palette.gray900,
  },
  planButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    backgroundColor: Palette.gray100,
    alignItems: "center",
    justifyContent: "center",
  },
  planButtonActive: { backgroundColor: Palette.brandWeak },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    backgroundColor: Palette.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonOff: { backgroundColor: Palette.gray200 },

  // 종료 제안 카드
  proposalWrap: { alignItems: "center", marginVertical: Spacing.xl },
  proposalCard: {
    width: "88%",
    backgroundColor: Palette.white,
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    alignItems: "center",
    borderWidth: Hairline.height,
    borderColor: Palette.gray200,
    ...Shadow.soft,
  },
  proposalIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    backgroundColor: Palette.redWeak,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.md,
  },
  proposalTitle: { ...Typo.subtitle, fontSize: 16 },
  proposalText: {
    ...Typo.caption,
    textAlign: "center",
    lineHeight: 19,
    marginTop: 6,
    marginBottom: Spacing.lg,
  },
  proposalResult: {
    ...Typo.caption,
    fontSize: 12,
    fontWeight: "700",
    color: Palette.gray600,
    marginTop: Spacing.sm,
  },
  proposalButtons: { flexDirection: "row", gap: Spacing.sm, width: "100%" },
  proposalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: Radius.md,
    alignItems: "center",
  },
  proposalReject: { backgroundColor: Palette.gray100 },
  proposalRejectText: {
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: Palette.gray700,
  },
  proposalAccept: { backgroundColor: Palette.red },
  proposalAcceptText: {
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: Palette.white,
  },

  // 시트
  sheetBody: { marginTop: Spacing.lg },
  sheetNotice: {
    ...Typo.caption,
    textAlign: "center",
    paddingVertical: Spacing.lg,
  },

  // 서랍
  drawerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(25,31,40,0.45)",
  },
  drawer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    width: DRAWER_WIDTH,
    backgroundColor: Palette.white,
    ...Shadow.modal,
  },
  drawerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: Spacing.xl,
    paddingRight: Spacing.md,
    paddingVertical: Spacing.md,
  },
  drawerTitle: { ...Typo.subtitle, fontSize: 17 },

  roomCard: {
    marginHorizontal: Spacing.xl,
    marginBottom: Spacing.lg,
    padding: Spacing.lg,
    borderRadius: Radius.md,
    backgroundColor: Palette.gray50,
    gap: Spacing.sm,
    alignItems: "flex-start",
  },
  roomName: { ...Typo.section, fontSize: 16 },

  drawerSection: {
    ...Typo.label,
    color: Palette.gray500,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
  },

  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    backgroundColor: Palette.gray100,
    alignItems: "center",
    justifyContent: "center",
  },
  memberAvatarText: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: Palette.gray700,
  },
  memberText: { flex: 1 },
  memberNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  memberName: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: Palette.gray900,
    flexShrink: 1,
  },
  memberDept: { ...Typo.caption, fontSize: 12, marginTop: 2 },

  drawerLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  drawerLinkText: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: -0.3,
    color: Palette.gray800,
  },

  drawerFooter: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    borderTopWidth: Hairline.height,
    borderTopColor: Hairline.color,
  },
  exitButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 14,
    borderRadius: Radius.md,
    backgroundColor: Palette.redWeak,
  },
  exitButtonText: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: Palette.red,
  },
});
