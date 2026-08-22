// 파일: app/chat/[id].tsx
import { Ionicons } from "@expo/vector-icons";
import * as Calendar from "expo-calendar";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
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

import { API } from "@/api/client";
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
/* 타입 / 목데이터                                                      */
/* ------------------------------------------------------------------ */

type Message = {
  id: string;
  text: string;
  sender: "me" | "them" | "system";
  /** them 메시지가 어느 참여자의 것인지 (차단·신고에 쓰인다) */
  senderId?: string;
  time: string;
  type?: "text" | "proposal";
};

type Participant = {
  id: string;
  name: string;
  dept: string;
  team: "MINE" | "PARTNER";
  isLeader?: boolean;
};

/**
 * 사람 목록은 아직 목업이다. 다만 소속 학과만큼은 실제 매칭된 팀을 따라가야
 * 해서, 이 배열은 뼈대로만 쓰고 화면에서 팀 정보를 덧입힌다.
 */
const BASE_PARTICIPANTS: Participant[] = [
  { id: "u_me", name: "나", dept: "경영학과", team: "MINE", isLeader: true },
  { id: "u_hm", name: "손흥민", dept: "경영학과", team: "MINE" },
  { id: "u_cr", name: "호날두", dept: "경영학과", team: "MINE" },
  {
    id: "u_ksh",
    name: "이형빈",
    dept: "시각디자인",
    team: "PARTNER",
    isLeader: true,
  },
  { id: "u_gks", name: "고경수", dept: "시각디자인", team: "PARTNER" },
  { id: "u_hr", name: "최우혁", dept: "시각디자인", team: "PARTNER" },
];

const MOCK_MESSAGES: Message[] = [
  {
    id: "1",
    text: "매칭이 성사되었어요! 🎉 이제 대화를 시작해보세요.",
    sender: "system",
    time: "",
  },
  {
    id: "2",
    text: "안녕하세요! 시티팝 좋아하세요? 제가 또 시티팝 계정 운영하고 있어서 ㅋㅋ",
    sender: "them",
    senderId: "u_ksh",
    time: "오후 12:01",
  },
  {
    id: "3",
    text: "야 윤형아 너 이상형 치어리더 아니냐?",
    sender: "them",
    senderId: "u_ksh",
    time: "오후 12:01",
  },
  {
    id: "4",
    text: "아 네.. 안녕하세요..ㅎㅎ",
    sender: "me",
    time: "오후 12:02",
  },
  {
    id: "5",
    text: "빨리 보고싶어요 :)",
    sender: "them",
    senderId: "u_gks",
    time: "오후 12:03",
  },
];

const REASON_LABEL = Object.fromEntries(
  REPORT_REASONS.map((r) => [r.value, r.label]),
) as Record<ReportReason, string>;

const DRAWER_WIDTH = Math.min(320, Dimensions.get("window").width * 0.84);

const formatTime = (d: Date) => {
  const h = d.getHours();
  const period = h < 12 ? "오전" : "오후";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${period} ${hour12}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const todayLabel = () => {
  const d = new Date();
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${days[d.getDay()]}요일`;
};

/* ------------------------------------------------------------------ */
/* 화면                                                                */
/* ------------------------------------------------------------------ */

export default function ChatRoom() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const {
    matches,
    posts,
    myTeams,
    matchedTeams,
    blockedUsers,
    submitReport,
    blockUser,
    unblockUser,
    setConfirmedPlan,
    clearConfirmedPlan,
  } = useStore();

  const [messages, setMessages] = useState<Message[]>(MOCK_MESSAGES);
  const [inputText, setInputText] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [planSheetOpen, setPlanSheetOpen] = useState(false);
  /** 점 세 개를 눌렀을 때 뜨는 액션 시트의 대상 */
  const [actionTarget, setActionTarget] = useState<Participant | null>(null);
  /** 신고 시트의 대상. 방 신고면 ROOM */
  const [reportTarget, setReportTarget] = useState<
    { type: "USER"; user: Participant } | { type: "ROOM" } | null
  >(null);

  const listRef = useRef<FlatList<Message>>(null);

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
  const lastAction = useRef<Participant | null>(null);
  if (actionTarget) lastAction.current = actionTarget;
  const actionSheetUser = actionTarget ?? lastAction.current;

  const lastReport = useRef<typeof reportTarget>(null);
  if (reportTarget) lastReport.current = reportTarget;
  const reportSheetTarget = reportTarget ?? lastReport.current;

  // 채팅방 id는 매칭 id다. (예전 경로로 팀 id를 들고 들어오는 경우만 아래에서 받아준다)
  const match = useMemo(() => matches.find((m) => m.id === id), [matches, id]);

  const roomTitle = useMemo(() => {
    if (match) return match.partnerTeamName;
    const team = posts.find((p) => p.id.toString() === id);
    return team?.title ?? "대화 상대를 찾을 수 없음";
  }, [id, match, posts]);

  // 매칭에 묶인 실제 팀. 학과·인원수를 여기서 가져온다.
  // 매칭이 성사되면 게시판에서 내려가므로 보관함(matchedTeams)까지 본다.
  const findTeam = (teamId?: string) =>
    teamId === undefined
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

  const participants = useMemo<Participant[]>(
    () =>
      BASE_PARTICIPANTS.map((p) => ({
        ...p,
        dept:
          (p.team === "PARTNER" ? partnerTeam?.dept : myTeam?.dept) ?? p.dept,
      })),
    [partnerTeam?.dept, myTeam?.dept],
  );

  const partnerMembers = participants.filter((p) => p.team === "PARTNER");
  const myMembers = participants.filter((p) => p.team === "MINE");

  // "소웨 코딩 기계들 (3:3)" — 어느 팀과 몇 대 몇으로 만나는지 헤더에서 바로 보이게
  const headerTitle = match
    ? `${match.partnerTeamName} (${myTeam?.count ?? myMembers.length}:${
        partnerTeam?.count ?? partnerMembers.length
      })`
    : roomTitle;

  /* ---------------- 메시지 ---------------- */

  const appendSystemMessage = (text: string) =>
    setMessages((prev) => [
      ...prev,
      { id: `sys_${Date.now()}`, text, sender: "system", time: "" },
    ]);

  const sendMessage = () => {
    const text = inputText.trim();
    if (!text) return;

    // 걸리면 전송하지 않고 입력값도 그대로 둔다. 고쳐서 다시 보내면 된다.
    if (hasProfanity(text)) {
      Alert.alert(PROFANITY_ALERT_TITLE, PROFANITY_ALERT_MESSAGE);
      return;
    }

    setMessages((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        text,
        sender: "me",
        time: formatTime(new Date()),
      },
    ]);
    setInputText("");
  };

  const sendExitProposal = () => {
    setDrawerOpen(false);
    setMessages((prev) => [
      ...prev,
      {
        id: `proposal_${Date.now()}`,
        text: "",
        sender: "system",
        time: "",
        type: "proposal",
      },
    ]);
  };

  const handleProposalDecision = (decision: "ACCEPT" | "REJECT") => {
    if (decision === "ACCEPT") {
      Alert.alert("채팅 종료", "양쪽 팀장의 동의로 채팅방이 종료되었어요.", [
        { text: "확인", onPress: () => router.replace("/(tabs)") },
      ]);
    } else {
      appendSystemMessage("상대 팀이 종료 제안을 거절했어요.");
    }
  };

  useEffect(() => {
    const t = setTimeout(
      () => listRef.current?.scrollToEnd({ animated: true }),
      120,
    );
    return () => clearTimeout(t);
  }, [messages]);

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
    setPlanSheetOpen(false);
    appendSystemMessage(
      `${plan ? "약속이 변경되었어요." : "약속이 확정되었어요."}\n${formatPlanSummary(next)}`,
    );
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
    setPlanSheetOpen(false);
    appendSystemMessage("확정된 약속을 취소했어요.");
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

  const openReportForUser = (user: Participant) => {
    setActionTarget(null);
    afterSheetClose(() => setReportTarget({ type: "USER", user }));
  };

  const openReportForRoom = () => {
    setDrawerOpen(false);
    setReportTarget({ type: "ROOM" });
  };

  const confirmBlock = (user: Participant) => {
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
            onPress: () => {
              blockUser({
                id: user.id,
                name: user.name,
                dept: user.dept,
                roomId: id,
              });
              appendSystemMessage(`${user.name} 님을 차단했어요.`);
            },
          },
        ],
      ),
    );
  };

  const handleUnblock = (user: Participant) => {
    setActionTarget(null);
    unblockUser(user.id);
    appendSystemMessage(`${user.name} 님의 차단을 해제했어요.`);
  };

  const handleReportSubmit = ({
    reason,
    detail,
    alsoBlock,
  }: {
    reason: ReportReason;
    detail: string;
    alsoBlock: boolean;
  }) => {
    if (!reportTarget) return;

    const isUser = reportTarget.type === "USER";
    const targetName = isUser ? reportTarget.user.name : roomTitle;

    const accepted = submitReport({
      targetType: isUser ? "USER" : "ROOM",
      targetId: isUser ? reportTarget.user.id : String(id),
      targetName,
      reason,
      detail,
      roomId: String(id),
    });

    if (isUser && alsoBlock) {
      const { user } = reportTarget;
      blockUser({ id: user.id, name: user.name, dept: user.dept, roomId: id });
    }

    setReportTarget(null);

    afterSheetClose(() => {
      if (!accepted) {
        Alert.alert(
          "이미 접수된 신고예요",
          "같은 대상에 대한 신고가 이미 접수되어 처리 중이에요.",
        );
        return;
      }
      appendSystemMessage(
        `${targetName} 신고가 접수되었어요. (사유: ${REASON_LABEL[reason]})` +
          (isUser && alsoBlock ? `\n${targetName} 님을 차단했어요.` : ""),
      );
      Alert.alert(
        "신고가 접수되었어요",
        "운영팀이 24시간 안에 확인하고 조치할게요.\n확인 결과는 알림으로 알려드립니다.",
      );
    });
  };

  /* ---------------- 렌더 ---------------- */

  const renderItem = ({ item, index }: { item: Message; index: number }) => {
    if (item.type === "proposal") {
      return <ProposalCard onDecide={handleProposalDecision} />;
    }

    if (item.sender === "system") {
      return (
        <View style={styles.systemRow}>
          <Text style={styles.systemText}>{item.text}</Text>
        </View>
      );
    }

    const isMe = item.sender === "me";
    const prev = messages[index - 1];
    const next = messages[index + 1];

    // 같은 사람이 연달아 보낸 말풍선은 이름·시간을 한 번만 보여준다
    const sameAsPrev =
      !!prev && prev.sender === item.sender && prev.senderId === item.senderId;
    const sameAsNext =
      !!next && next.sender === item.sender && next.senderId === item.senderId;
    const showHeader = !isMe && !sameAsPrev;
    const showTime = !sameAsNext || next?.time !== item.time;

    const sender = participants.find((p) => p.id === item.senderId);
    const isBlockedSender = !!item.senderId && blockedIds.has(item.senderId);

    return (
      <View
        style={[styles.messageBlock, sameAsPrev && styles.messageBlockTight]}
      >
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

          {isBlockedSender ? (
            <View style={styles.blockedBubble}>
              <Ionicons
                name="eye-off-outline"
                size={14}
                color={Palette.gray500}
              />
              <Text style={styles.blockedText}>차단한 사용자의 메시지예요</Text>
            </View>
          ) : (
            <Pressable
              onLongPress={() => sender && setActionTarget(sender)}
              delayLongPress={300}
              disabled={isMe}
              style={({ pressed }) => [
                styles.bubble,
                isMe ? styles.myBubble : styles.theirBubble,
                showHeader && !isMe && styles.theirBubbleFirst,
                isMe && !sameAsPrev && styles.myBubbleFirst,
                pressed && !isMe && { opacity: 0.85 },
              ]}
            >
              <Text style={[styles.bubbleText, isMe && styles.myBubbleText]}>
                {item.text}
              </Text>
            </Pressable>
          )}

          {showTime && <Text style={styles.timeText}>{item.time}</Text>}
        </View>
      </View>
    );
  };

  const canSend = inputText.trim().length > 0;

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
        <FlatList
          ref={listRef}
          data={messages}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          // 차단하면 이미 그려진 말풍선도 즉시 가려져야 한다
          extraData={blockedUsers}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="on-drag"
          ListHeaderComponent={
            <View style={styles.dateRow}>
              <Text style={styles.dateText}>{todayLabel()}</Text>
            </View>
          }
        />

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
      </KeyboardAvoidingView>

      <ChatDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        roomTitle={roomTitle}
        myMembers={myMembers}
        partnerMembers={partnerMembers}
        blockedIds={blockedIds}
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

function ProposalCard({
  onDecide,
}: {
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
          상대 팀장이 대화 종료를 제안했어요.{"\n"}동의하면 채팅방이 사라져요.
        </Text>
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
  myMembers: Participant[];
  partnerMembers: Participant[];
  blockedIds: Set<string>;
  onPressMember: (p: Participant) => void;
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

  const renderMember = (p: Participant, actionable: boolean) => {
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
            <Badge label="매칭 진행 중" tone="success" />
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
          <PressScale
            scaleTo={0.97}
            style={styles.exitButton}
            onPress={onExitProposal}
          >
            <Ionicons name="log-out-outline" size={18} color={Palette.red} />
            <Text style={styles.exitButtonText}>채팅방 종료 제안</Text>
          </PressScale>
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
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xl,
  },

  dateRow: { alignItems: "center", marginBottom: Spacing.lg },
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

  bubbleRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: Spacing.xs,
  },
  bubbleRowMine: { justifyContent: "flex-end" },

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
    maxWidth: "72%",
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

  blockedBubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: "72%",
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

  timeText: {
    fontSize: 11,
    color: Palette.gray400,
    marginBottom: 2,
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
