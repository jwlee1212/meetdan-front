// 파일: app/signupScreen.tsx
import { Ionicons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-aware-scroll-view";

import { API } from "@/api/client";
import {
  CAMPUS_LIST,
  Campus,
  College,
  getCollegesByCampus,
} from "@/constants/departments";
import { Colors } from "@/constants/theme";
import { useStore } from "@/store/useStore";
import { InputBox } from "../components/InputBox";
import { MainButton } from "../components/MainButton";

// 이메일 인증 시점에 서버로 가입 정보를 넘기므로 계정 정보를 먼저 받는다
const STEPS = [
  "이름",
  "성별",
  "나이",
  "학과",
  "계정 정보",
  "이메일 인증",
] as const;
const TOTAL_STEPS = STEPS.length;
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@dankook\.ac\.kr$/i;
const MIN_ID_LENGTH = 2;
const MIN_PASSWORD_LENGTH = 6;

/**
 * 나이가 아니라 출생연도를 받는다.
 * 나이를 그대로 저장하면 해가 바뀌어도 값이 안 늙는다. 팀 평균 나이
 * (teams.avg_age)는 서버가 팀원들의 이 값으로 계산한다(마이그레이션 006).
 */
const CURRENT_YEAR = new Date().getFullYear();
const MIN_BIRTH_YEAR = CURRENT_YEAR - 40; // 세는나이 41세
const MAX_BIRTH_YEAR = CURRENT_YEAR - 16; // 세는나이 17세

/** 세는나이. 서버 korean_age() 와 같은 식이다. */
const toKoreanAge = (birthYear: number) => CURRENT_YEAR - birthYear + 1;

// 캠퍼스 → 단과대 → 학과 전환 애니메이션 설정
const STAGE_FADE_OUT_DURATION = 130; // 현재 목록이 사라지는 시간
const STAGE_FADE_IN_DURATION = 220; // 다음 목록이 들어오는 시간
const STAGE_SLIDE_DISTANCE = 28; // 좌우로 미끄러지는 거리(px)

export default function SignupScreen() {
  const router = useRouter();
  const setCurrentUser = useStore((state) => state.setCurrentUser);
  const [step, setStep] = useState(0);

  // 입력 값
  const [name, setName] = useState("");
  const [gender, setGender] = useState<"M" | "F" | null>(null);
  const [birthYear, setBirthYear] = useState("");
  const [campus, setCampus] = useState<Campus | null>(null);
  const [college, setCollege] = useState<College | null>(null);
  const [dept, setDept] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");

  // 제출 상태
  const [isSubmitting, setIsSubmitting] = useState(false);
  // 이메일 인증 상태
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isEmailSent, setIsEmailSent] = useState(false);
  const [isEmailVerified, setIsEmailVerified] = useState(false);

  // 상단 프로세스바 애니메이션
  const progress = useRef(new Animated.Value(1 / TOTAL_STEPS)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: (step + 1) / TOTAL_STEPS,
      duration: 350,
      useNativeDriver: false,
    }).start();
  }, [step]);

  // 학과 단계(캠퍼스 → 단과대 → 학과) 전환 애니메이션
  // -1 ~ 1 값을 좌우 이동 + 투명도로 변환해서 사용합니다.
  const stageAnim = useRef(new Animated.Value(0)).current;
  const isStageAnimating = useRef(false);
  const scrollRef = useRef<KeyboardAwareScrollView>(null);

  /**
   * 현재 목록을 살짝 밀어내며 감춘 뒤(apply) 상태를 바꾸고,
   * 반대편에서 다음 목록이 들어오도록 합니다.
   * direction: 1 = 다음 단계로, -1 = 이전 단계로
   */
  const runStageTransition = (direction: 1 | -1, apply: () => void) => {
    if (isStageAnimating.current) return; // 연타로 단계가 건너뛰는 것 방지
    isStageAnimating.current = true;

    Animated.timing(stageAnim, {
      toValue: -direction,
      duration: STAGE_FADE_OUT_DURATION,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(() => {
      // 화면이 완전히 가려진 시점에 내용 교체 → 중간에 깜빡이지 않음
      apply();
      scrollRef.current?.scrollToPosition(0, 0, false);
      stageAnim.setValue(direction);

      Animated.timing(stageAnim, {
        toValue: 0,
        duration: STAGE_FADE_IN_DURATION,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        isStageAnimating.current = false;
      });
    });
  };

  const stageAnimatedStyle = {
    opacity: stageAnim.interpolate({
      inputRange: [-1, 0, 1],
      outputRange: [0, 1, 0],
    }),
    transform: [
      {
        translateX: stageAnim.interpolate({
          inputRange: [-1, 0, 1],
          outputRange: [-STAGE_SLIDE_DISTANCE, 0, STAGE_SLIDE_DISTANCE],
        }),
      },
    ],
  };

  const handleBack = () => {
    if (step === 0) {
      router.back();
      return;
    }
    // 학과 단계는 캠퍼스 → 단과대 → 학과 순서라 한 단계씩 거슬러 올라감
    if (step === 3 && college) {
      runStageTransition(-1, () => {
        setCollege(null);
        setDept("");
      });
      return;
    }
    if (step === 3 && campus) {
      runStageTransition(-1, () => setCampus(null));
      return;
    }
    setStep((prev) => prev - 1);
  };

  // 선택한 캠퍼스의 단과대 목록 (캠퍼스 미선택이면 빈 배열)
  const campusColleges = campus ? getCollegesByCampus(campus) : [];

  const handleSelectCampus = (selected: Campus) => {
    runStageTransition(1, () => {
      setCampus(selected);
      setCollege(null);
      setDept("");
    });
  };

  const handleSelectCollege = (selected: College) => {
    runStageTransition(1, () => {
      setCollege(selected);
      setDept("");
    });
  };

  const handleSendCode = async () => {
    if (!EMAIL_REGEX.test(email.trim())) {
      Alert.alert("알림", "단국대 이메일(@dankook.ac.kr)만 사용할 수 있어요.");
      return;
    }

    try {
      setIsSendingCode(true);
      // 계정 생성은 마지막 '가입 완료'에서 한 번에 한다. 여기서는 인증번호만 받는다.
      const result = await API.requestEmailAuth(email.trim());
      if (result.code === 200) {
        setIsEmailSent(true);
        Alert.alert(
          "인증번호 발송",
          result.message ?? "인증번호가 발송되었습니다.",
        );
      } else {
        Alert.alert("발송 실패", result.message ?? "다시 시도해주세요.");
      }
    } catch (e) {
      Alert.alert("오류", "인증번호 발송 중 문제가 발생했습니다.");
    } finally {
      setIsSendingCode(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!code.trim()) {
      Alert.alert("알림", "인증번호를 입력해주세요.");
      return;
    }

    try {
      setIsVerifying(true);
      const result = await API.verifyEmailCode(email.trim(), code.trim());
      if (result.code === 200) {
        setIsEmailVerified(true);
        Alert.alert("인증 완료", "이메일 인증이 완료되었습니다.");
      } else {
        Alert.alert("인증 실패", result.message ?? "인증번호를 확인해주세요.");
      }
    } catch (e) {
      Alert.alert("오류", "인증번호 확인 중 문제가 발생했습니다.");
    } finally {
      setIsVerifying(false);
    }
  };

  const handleNext = async () => {
    if (step === 0) {
      if (!name.trim()) {
        Alert.alert("알림", "이름을 입력해주세요.");
        return;
      }
      setStep(1);
      return;
    }

    if (step === 1) {
      if (!gender) {
        Alert.alert("알림", "성별을 선택해주세요.");
        return;
      }
      setStep(2);
      return;
    }

    if (step === 2) {
      const year = parseInt(birthYear, 10);
      if (
        birthYear.length !== 4 ||
        Number.isNaN(year) ||
        year < MIN_BIRTH_YEAR ||
        year > MAX_BIRTH_YEAR
      ) {
        Alert.alert(
          "알림",
          `출생연도를 ${MIN_BIRTH_YEAR}~${MAX_BIRTH_YEAR} 사이로 입력해주세요.`,
        );
        return;
      }
      setStep(3);
      return;
    }

    if (step === 3) {
      if (!campus) {
        Alert.alert("알림", "캠퍼스를 선택해주세요.");
        return;
      }
      if (!college) {
        Alert.alert("알림", "단과대를 선택해주세요.");
        return;
      }
      if (!dept) {
        Alert.alert("알림", "학과를 선택해주세요.");
        return;
      }
      setStep(4);
      return;
    }

    if (step === 4) {
      if (userId.trim().length < MIN_ID_LENGTH) {
        Alert.alert("알림", `아이디는 ${MIN_ID_LENGTH}자 이상 입력해주세요.`);
        return;
      }
      if (password.length < MIN_PASSWORD_LENGTH) {
        Alert.alert(
          "알림",
          `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상 입력해주세요.`,
        );
        return;
      }
      if (password !== passwordConfirm) {
        Alert.alert("알림", "비밀번호가 일치하지 않아요.");
        return;
      }

      // 아이디 중복은 여기서 걸러낸다. 마지막 단계에서 터지면
      // 이메일 인증까지 다 해놓고 계정 정보 단계로 되돌아가야 해서 사용자가 화난다.
      try {
        setIsSubmitting(true);
        const check = await API.checkLoginId(userId.trim());
        if (check.code !== 200) {
          Alert.alert("알림", check.message ?? "다른 아이디를 사용해주세요.");
          return;
        }
      } catch (e) {
        Alert.alert("오류", "아이디 확인 중 문제가 발생했습니다.");
        return;
      } finally {
        setIsSubmitting(false);
      }

      setStep(5);
      return;
    }

    if (step === 5) {
      if (!isEmailVerified) {
        Alert.alert("알림", "이메일 인증을 완료해주세요.");
        return;
      }

      // 앞 단계에서 이미 검증했지만, 타입 보장을 위해 한 번 더 확인
      const year = parseInt(birthYear, 10);
      if (!gender || !campus || !dept || Number.isNaN(year)) {
        Alert.alert("알림", "이전 단계의 정보를 다시 확인해주세요.");
        return;
      }

      try {
        setIsSubmitting(true);

        // 비밀번호는 Supabase Auth 로만 가고 기기에는 남기지 않습니다.
        const result = await API.signup({
          name: name.trim(),
          gender,
          birthYear: year,
          campus,
          dept,
          email: email.trim(),
          userId: userId.trim(),
          password,
        });

        if (result.code !== 200 || !result.data) {
          Alert.alert("회원가입 실패", result.message ?? "다시 시도해주세요.");
          return;
        }

        // 가입 직후 이미 로그인된 상태다. 다시 로그인시키지 않고 바로 들여보낸다.
        setCurrentUser(result.data);

        Alert.alert("회원가입 완료", "밋단에 오신 것을 환영해요!", [
          { text: "확인", onPress: () => router.replace("/(tabs)") },
        ]);
      } catch (e) {
        Alert.alert("오류", "회원가입 처리 중 문제가 발생했습니다.");
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const isLastStep = step === TOTAL_STEPS - 1;

  return (
    <View style={styles.container}>
      {/* iOS 엣지 스와이프로 뒤로가면 handleBack 의 단계별 로직을 건너뛰고
          화면 자체를 나가버려서 꺼둔다. 뒤로가기는 헤더의 버튼으로만 한다. */}
      <Stack.Screen options={{ gestureEnabled: false }} />

      {/* 헤더 + 프로세스바 (키보드 영향 없는 고정 영역) */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={handleBack} hitSlop={10}>
            <Ionicons name="chevron-back" size={26} color="#333" />
          </TouchableOpacity>
          <Text style={styles.stepIndicator}>
            {step + 1} / {TOTAL_STEPS}
          </Text>
        </View>

        <View style={styles.progressTrack}>
          <Animated.View
            style={[
              styles.progressFill,
              {
                width: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: ["0%", "100%"],
                }),
              },
            ]}
          />
        </View>
      </View>

      <KeyboardAwareScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        // 안드로이드에서도 iOS와 동일하게 자동 오프셋 계산이 동작하도록 설정
        enableOnAndroid
        // 포커스된 인풋이 화면 하단 여백만큼 위로 부드럽게 올라오도록 여유 공간 확보
        extraScrollHeight={Platform.OS === "ios" ? 20 : 40}
        // 포커스 시 기본 스크롤 애니메이션 대신 즉시 위치를 잡아 버벅임 방지
        enableAutomaticScroll
        keyboardOpeningTime={0}
        // 버튼 탭이 키보드에 가려 씹히지 않도록 유지
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {step === 0 && (
          <View>
            <Text style={styles.title}>
              반가워요!{"\n"}이름이 어떻게 되세요?
            </Text>
            <Text style={styles.subtitle}>실명으로 입력해주세요</Text>
            <InputBox
              label="이름"
              placeholder="홍길동"
              value={name}
              onChangeText={setName}
              autoFocus
            />
          </View>
        )}

        {step === 1 && (
          <View>
            <Text style={styles.title}>성별을{"\n"}알려주세요</Text>
            <Text style={styles.subtitle}>매칭에 활용되는 정보예요</Text>
            <View style={styles.genderRow}>
              <TouchableOpacity
                style={[
                  styles.genderButton,
                  gender === "M" && styles.genderButtonActive,
                ]}
                onPress={() => setGender("M")}
              >
                <Ionicons
                  name="male"
                  size={22}
                  color={gender === "M" ? "#fff" : "#666"}
                />
                <Text
                  style={[
                    styles.genderText,
                    gender === "M" && styles.genderTextActive,
                  ]}
                >
                  남성
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.genderButton,
                  gender === "F" && styles.genderButtonActive,
                ]}
                onPress={() => setGender("F")}
              >
                <Ionicons
                  name="female"
                  size={22}
                  color={gender === "F" ? "#fff" : "#666"}
                />
                <Text
                  style={[
                    styles.genderText,
                    gender === "F" && styles.genderTextActive,
                  ]}
                >
                  여성
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {step === 2 && (
          <View>
            <Text style={styles.title}>태어난 연도를{"\n"}알려주세요</Text>
            <Text style={styles.subtitle}>
              팀 평균 나이를 자동으로 계산하는 데 쓰여요
            </Text>
            <InputBox
              label="출생연도"
              placeholder={`${MIN_BIRTH_YEAR} ~ ${MAX_BIRTH_YEAR}`}
              value={birthYear}
              onChangeText={(text) =>
                setBirthYear(text.replace(/[^0-9]/g, "").slice(0, 4))
              }
              keyboardType="number-pad"
              maxLength={4}
              autoFocus
            />
            {birthYear.length === 4 && (
              <Text style={styles.ageEcho}>
                {toKoreanAge(parseInt(birthYear, 10))}세
              </Text>
            )}
            <Text style={styles.noticeText}>
              한 번 등록하면 바꿀 수 없어요. 나이가 그대로 노출되지는 않고, 팀에
              모인 사람들의 평균으로만 보여요.
            </Text>
          </View>
        )}

        {step === 3 && (
          <Animated.View style={stageAnimatedStyle}>
            {/* 학과 단계 1/3 : 캠퍼스 선택 */}
            {!campus && (
              <View>
                <Text style={styles.title}>캠퍼스를{"\n"}선택해주세요</Text>
                <Text style={styles.subtitle}>소속 캠퍼스를 골라주세요</Text>

                <View style={styles.listCard}>
                  {CAMPUS_LIST.map((item, index) => (
                    <TouchableOpacity
                      key={item}
                      style={[
                        styles.listRow,
                        index === 0 && styles.listRowFirst,
                      ]}
                      activeOpacity={0.6}
                      onPress={() => handleSelectCampus(item)}
                    >
                      <Text style={styles.listRowText}>{item}캠퍼스</Text>
                      <Ionicons
                        name="chevron-forward"
                        size={18}
                        color="#B0B8C1"
                      />
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {/* 학과 단계 2/3 : 단과대 선택 */}
            {campus && !college && (
              <View>
                <Text style={styles.title}>단과대를{"\n"}선택해주세요</Text>
                <Text style={styles.subtitle}>소속 단과대를 골라주세요</Text>

                {/* 선택한 캠퍼스 표시 + 다시 선택 */}
                <View style={styles.selectionChip}>
                  <Text style={styles.selectionChipText}>{campus}캠퍼스</Text>
                  <TouchableOpacity
                    onPress={() =>
                      runStageTransition(-1, () => setCampus(null))
                    }
                    hitSlop={10}
                  >
                    <Text style={styles.selectionChipAction}>변경</Text>
                  </TouchableOpacity>
                </View>

                {campusColleges.length === 0 ? (
                  <Text style={styles.emptyText}>
                    등록된 단과대가 없어요. 캠퍼스를 다시 선택해주세요.
                  </Text>
                ) : (
                  <View style={styles.listCard}>
                    {campusColleges.map((item, index) => (
                      <TouchableOpacity
                        key={item.id}
                        style={[
                          styles.listRow,
                          index === 0 && styles.listRowFirst,
                        ]}
                        activeOpacity={0.6}
                        onPress={() => handleSelectCollege(item)}
                      >
                        <Text style={styles.listRowText}>{item.name}</Text>
                        <Ionicons
                          name="chevron-forward"
                          size={18}
                          color="#B0B8C1"
                        />
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* 학과 단계 3/3 : 세부 학과 선택 */}
            {campus && college && (
              <View>
                <Text style={styles.title}>학과를{"\n"}선택해주세요</Text>
                <Text style={styles.subtitle}>소속 학과를 골라주세요</Text>

                {/* 선택한 캠퍼스 · 단과대 표시 + 다시 선택 */}
                <View style={styles.selectionChip}>
                  <Text style={styles.selectionChipText}>
                    {campus}캠퍼스 · {college.name}
                  </Text>
                  <TouchableOpacity
                    onPress={() =>
                      runStageTransition(-1, () => {
                        setCollege(null);
                        setDept("");
                      })
                    }
                    hitSlop={10}
                  >
                    <Text style={styles.selectionChipAction}>변경</Text>
                  </TouchableOpacity>
                </View>

                {college.departments.length === 0 ? (
                  <Text style={styles.emptyText}>
                    등록된 학과가 없어요. 단과대를 다시 선택해주세요.
                  </Text>
                ) : (
                  <View style={styles.listCard}>
                    {college.departments.map((item, index) => (
                      <DeptRow
                        key={item}
                        name={item}
                        isFirst={index === 0}
                        isSelected={dept === item}
                        onPress={() => setDept(item)}
                      />
                    ))}
                  </View>
                )}
              </View>
            )}
          </Animated.View>
        )}

        {step === 4 && (
          <View>
            <Text style={styles.title}>
              로그인에 사용할{"\n"}계정 정보를 입력해주세요
            </Text>
            <Text style={styles.subtitle}>
              아이디와 비밀번호는 로그인 시 사용돼요
            </Text>

            <InputBox
              label="아이디"
              placeholder={`${MIN_ID_LENGTH}자 이상 입력`}
              value={userId}
              onChangeText={setUserId}
              autoFocus
            />
            <InputBox
              label="비밀번호"
              placeholder={`${MIN_PASSWORD_LENGTH}자 이상 입력`}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
            <InputBox
              label="비밀번호 확인"
              placeholder="비밀번호를 다시 입력해주세요"
              value={passwordConfirm}
              onChangeText={setPasswordConfirm}
              secureTextEntry
            />
          </View>
        )}

        {step === 5 && (
          <View>
            <Text style={styles.title}>이메일 인증을{"\n"}진행해주세요</Text>
            <Text style={styles.subtitle}>
              단국대 이메일(@dankook.ac.kr)만 가능해요
            </Text>

            <InputBox
              label="학교 이메일"
              placeholder="example@dankook.ac.kr"
              value={email}
              onChangeText={(text) => {
                setEmail(text);
                setIsEmailSent(false);
                setIsEmailVerified(false);
              }}
              keyboardType="email-address"
              editable={!isEmailVerified}
            />

            <TouchableOpacity
              style={[
                styles.secondaryButton,
                isEmailVerified && styles.secondaryButtonDisabled,
              ]}
              onPress={handleSendCode}
              disabled={isSendingCode || isEmailVerified}
            >
              {isSendingCode ? (
                <ActivityIndicator color={Colors.light.primary} />
              ) : (
                <Text style={styles.secondaryButtonText}>
                  {isEmailSent ? "인증번호 재발송" : "인증번호 받기"}
                </Text>
              )}
            </TouchableOpacity>

            {isEmailSent && !isEmailVerified && (
              <View style={styles.codeRow}>
                <View style={styles.codeInputWrapper}>
                  <InputBox
                    label="인증번호"
                    placeholder="숫자 6자리"
                    value={code}
                    onChangeText={setCode}
                    keyboardType="number-pad"
                    maxLength={6}
                  />
                </View>
                <TouchableOpacity
                  style={styles.verifyButton}
                  onPress={handleVerifyCode}
                  disabled={isVerifying}
                >
                  {isVerifying ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.verifyButtonText}>확인</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {isEmailVerified && (
              <View style={styles.verifiedBanner}>
                <Ionicons name="checkmark-circle" size={18} color="#2FB56B" />
                <Text style={styles.verifiedText}>
                  이메일 인증이 완료되었어요
                </Text>
              </View>
            )}
          </View>
        )}

        <View style={styles.footer}>
          <MainButton
            title={isLastStep ? "가입 완료" : "다음"}
            onPress={handleNext}
            isLoading={isSubmitting}
          />
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

/** 학과 목록의 한 줄. 선택 표시가 툭 켜지지 않고 부드럽게 물들도록 처리합니다. */
function DeptRow({
  name,
  isFirst,
  isSelected,
  onPress,
}: {
  name: string;
  isFirst: boolean;
  isSelected: boolean;
  onPress: () => void;
}) {
  const selectAnim = useRef(new Animated.Value(isSelected ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(selectAnim, {
      toValue: isSelected ? 1 : 0,
      duration: 180,
      easing: Easing.out(Easing.quad),
      // 배경색/글자색은 네이티브 드라이버를 지원하지 않음
      useNativeDriver: false,
    }).start();
  }, [isSelected]);

  return (
    <TouchableOpacity activeOpacity={0.6} onPress={onPress}>
      <Animated.View
        style={[
          styles.listRow,
          isFirst && styles.listRowFirst,
          {
            backgroundColor: selectAnim.interpolate({
              inputRange: [0, 1],
              outputRange: ["#FFFFFF", Colors.light.primaryMuted],
            }),
          },
        ]}
      >
        <Animated.Text
          style={[
            styles.listRowText,
            {
              color: selectAnim.interpolate({
                inputRange: [0, 1],
                outputRange: ["#333333", Colors.light.primary],
              }),
            },
          ]}
        >
          {name}
        </Animated.Text>
        <Animated.View
          style={{
            opacity: selectAnim,
            transform: [
              {
                scale: selectAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.6, 1],
                }),
              },
            ],
          }}
        >
          <Ionicons name="checkmark" size={18} color={Colors.light.primary} />
        </Animated.View>
      </Animated.View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  header: {
    paddingTop: 60,
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  stepIndicator: {
    fontSize: 14,
    fontWeight: "600",
    color: "#999",
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: "#EEF1F5",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
    backgroundColor: Colors.light.primary,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 20,
  },
  title: {
    fontSize: 26,
    fontWeight: "bold",
    color: "#222",
    lineHeight: 34,
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 15,
    color: "#888",
    marginBottom: 32,
  },
  genderRow: {
    flexDirection: "row",
    gap: 12,
  },
  // 출생연도를 적는 동안 "지금 몇 살로 계산되는지"를 바로 되비춘다
  ageEcho: {
    marginTop: -8,
    fontSize: 15,
    fontWeight: "600",
    color: Colors.light.primary,
  },
  noticeText: {
    marginTop: 20,
    fontSize: 13,
    lineHeight: 19,
    color: "#999",
  },
  genderButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 18,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#ddd",
    backgroundColor: "#f9f9f9",
  },
  genderButtonActive: {
    backgroundColor: Colors.light.primary,
    borderColor: Colors.light.primary,
  },
  genderText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#666",
  },
  genderTextActive: {
    color: "#fff",
  },
  // 단과대 / 학과 선택 리스트
  listCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#EEF1F5",
    overflow: "hidden",
    backgroundColor: "#fff",
  },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 18,
    paddingHorizontal: 18,
    borderTopWidth: 1,
    borderTopColor: "#EEF1F5",
  },
  listRowFirst: {
    borderTopWidth: 0,
  },
  listRowSelected: {
    backgroundColor: Colors.light.primaryMuted,
  },
  listRowText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  listRowTextSelected: {
    color: Colors.light.primary,
    fontWeight: "700",
  },
  selectionChip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: Colors.light.backgroundMuted,
    marginBottom: 14,
  },
  selectionChipText: {
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
    color: "#333",
  },
  selectionChipAction: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.light.primary,
  },
  emptyText: {
    fontSize: 14,
    color: "#999",
    paddingVertical: 20,
    textAlign: "center",
  },
  secondaryButton: {
    borderWidth: 1.5,
    borderColor: Colors.light.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -6,
  },
  secondaryButtonDisabled: {
    borderColor: "#ddd",
  },
  secondaryButtonText: {
    color: Colors.light.primary,
    fontSize: 15,
    fontWeight: "bold",
  },
  codeRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    marginTop: 20,
  },
  codeInputWrapper: {
    flex: 1,
  },
  verifyButton: {
    backgroundColor: "#333",
    borderRadius: 12,
    paddingHorizontal: 20,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  verifyButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "bold",
  },
  verifiedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 18,
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#EFFBF3",
  },
  verifiedText: {
    color: "#2FB56B",
    fontSize: 14,
    fontWeight: "600",
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: Platform.OS === "ios" ? 30 : 20,
    paddingTop: 10,
  },
});
