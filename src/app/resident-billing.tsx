import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AllocationHistoryCard } from '@/components/student-billing/AllocationHistoryCard';
import {
  PaymentProofModal,
  SelectedScreenshotAsset,
} from '@/components/student-billing/PaymentProofModal';
import { StudentChargeList } from '@/components/student-billing/StudentChargeList';
import { RoleBottomNav } from '@/components/ui/bottom-nav';
import { BillingSkeleton, OwnerHeader } from '@/components/ui/owner';
import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useResident } from '@/context/resident-context';
import { useToast } from '@/context/toast-context';
import {
  useStudentBillingQuery,
  useSubmitPaymentProofMutation,
  useWithdrawPaymentProofMutation,
} from '@/hooks/use-student-billing';
import { compressPickedImage } from '@/lib/image-upload';
import { buildUpiPaymentUrl } from '@/lib/upi';
import { normalizeUpiUtr } from '@/lib/upi-verification';
import { formatRoomLabel } from '@/lib/ux-utils';
import {
  PaymentMethod,
  PreResolvedStudentContext,
  StudentBillCardItem,
} from '@/services/billing.service';

export default function SimplifiedStudentBillingScreen() {
  const { user } = useAuth();
  const { resident: sharedResident } = useResident();
  const { showToast } = useToast();
  const userId = user?.id;

  const [manualRefreshing, setManualRefreshing] = useState(false);
  const submittingProofRef = useRef(false);
  const lastErrorAtRef = useRef(0);
  const [breakdownExpanded, setBreakdownExpanded] = useState(false);

  // Payment Proof Modal
  const [selectedBillForPayment, setSelectedBillForPayment] =
    useState<StudentBillCardItem | null>(null);
  const [paymentModalVisible, setPaymentModalVisible] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('upi');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [studentNotes, setStudentNotes] = useState('');
  const [selectedScreenshot, setSelectedScreenshot] =
    useState<SelectedScreenshotAsset | null>(null);

  const residentContext = useMemo<PreResolvedStudentContext | null>(
    () =>
      sharedResident
        ? {
            residentId: sharedResident.residentId,
            residentName: sharedResident.fullName,
            roomNumber: sharedResident.roomNumber,
            propertyId: sharedResident.propertyId,
            propertyName: sharedResident.propertyName,
            ownerUpiId: sharedResident.ownerUpiId,
            ownerUpiPayeeName: sharedResident.ownerUpiPayeeName,
          }
        : null,
    [sharedResident]
  );

  const billingQuery = useStudentBillingQuery(userId, residentContext);
  const paymentProofMutation = useSubmitPaymentProofMutation();
  const withdrawProofMutation = useWithdrawPaymentProofMutation();
  const [withdrawingReportId, setWithdrawingReportId] = useState<string | null>(
    null
  );

  const snapshot = billingQuery.data;
  const loading = billingQuery.isPending && !snapshot;
  const refreshing = manualRefreshing;
  const residentId = snapshot?.residentId ?? sharedResident?.residentId ?? null;
  const roomNumber = snapshot?.roomNumber ?? sharedResident?.roomNumber ?? '';
  const propertyName =
    snapshot?.propertyName ?? sharedResident?.propertyName ?? 'My PG';
  const ownerUpiId =
    snapshot?.ownerUpiId ?? sharedResident?.ownerUpiId ?? null;
  const ownerUpiPayeeName =
    snapshot?.ownerUpiPayeeName ?? sharedResident?.ownerUpiPayeeName ?? null;
  const currentRentBill = snapshot?.currentRentBill ?? null;
  const currentEbBill = snapshot?.currentEbBill ?? null;
  const unpaidBills = useMemo(
    () => snapshot?.unpaidBills ?? [],
    [snapshot?.unpaidBills]
  );
  const pastBills = snapshot?.pastBills ?? [];
  const submittingProof = paymentProofMutation.isPending;

  // Android memory-pressure recovery: if the OS killed our activity while the gallery
  // was open, recover the picked screenshot on mount instead of losing it.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let active = true;
    void (async () => {
      try {
        const pending = await ImagePicker.getPendingResultAsync();
        if (!active || !pending) return;
        const result = Array.isArray(pending) ? pending[0] : pending;
        if (
          result &&
          'canceled' in result &&
          !result.canceled &&
          Array.isArray(result.assets) &&
          result.assets.length > 0
        ) {
          const compressed = await compressPickedImage(result.assets[0]);
          if (active && compressed.ok) {
            setSelectedScreenshot({
              uri: compressed.data.uri,
              base64: compressed.data.base64,
            });
          }
        }
      } catch {
        // Non-fatal: no pending picker result
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (
      billingQuery.isError &&
      billingQuery.errorUpdatedAt > lastErrorAtRef.current &&
      (!snapshot || manualRefreshing)
    ) {
      lastErrorAtRef.current = billingQuery.errorUpdatedAt;
      Alert.alert('Load Error', billingQuery.error.message);
    }
  }, [
    billingQuery.isError,
    billingQuery.error,
    billingQuery.errorUpdatedAt,
    snapshot,
    manualRefreshing,
  ]);

  const handleRefresh = async () => {
    setManualRefreshing(true);
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        billingQuery.refetch(),
        new Promise<void>((resolve) => {
          timeoutId = setTimeout(resolve, 10_000);
        }),
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      setManualRefreshing(false);
    }
  };

  // Launch Image Picker to choose screenshot proof (no cropper activity to avoid Android OOM)
  const handlePickScreenshot = async () => {
    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          'Permission Needed',
          'Please allow photo gallery access to upload payment screenshot.'
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.7,
        base64: false,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const compressed = await compressPickedImage(result.assets[0]);
        if (!compressed.ok) {
          Alert.alert('Image Too Large', compressed.error);
          return;
        }
        setSelectedScreenshot({
          uri: compressed.data.uri,
          base64: compressed.data.base64,
        });
      }
    } catch {
      Alert.alert(
        'Notice',
        'Photo gallery not available on this device. You can enter the Transaction ID manually.'
      );
    }
  };

  // Withdraw a pending payment proof so the resident can pay or re-upload
  const handleWithdrawProof = (bill: StudentBillCardItem) => {
    const report = bill.pending_report;
    if (!report || report.status !== 'pending' || withdrawingReportId) return;

    Alert.alert(
      'Withdraw Payment Proof?',
      `Remove your pending proof for ${bill.month_label} ${bill.title}? You can submit a new proof afterwards.`,
      [
        { text: 'Keep Pending', style: 'cancel' },
        {
          text: 'Withdraw',
          style: 'destructive',
          onPress: () => {
            setWithdrawingReportId(report.id);
            void withdrawProofMutation
              .mutateAsync({
                reportId: report.id,
                screenshotUrl: report.screenshot_url,
              })
              .then(() => {
                showToast('Payment proof withdrawn');
              })
              .catch((err) => {
                Alert.alert(
                  'Withdraw Failed',
                  err instanceof Error
                    ? err.message
                    : 'Could not withdraw payment proof.'
                );
              })
              .finally(() => {
                setWithdrawingReportId(null);
              });
          },
        },
      ]
    );
  };

  // Open Payment Proof Modal for a specific bill
  const handleOpenPaymentModal = (bill: StudentBillCardItem) => {
    if (bill.pending_report?.status === 'pending') {
      showToast('Payment proof for this bill is already awaiting owner approval');
      return;
    }
    setSelectedBillForPayment(bill);
    setPaymentMethod('upi');
    setReferenceNumber('');
    setStudentNotes('');
    setSelectedScreenshot(null);
    setPaymentModalVisible(true);
  };

  // Launch owner UPI deep link and prompt resident to upload proof
  const handlePayNow = async (bill: StudentBillCardItem) => {
    const upiUrl = buildUpiPaymentUrl({
      upiId: ownerUpiId,
      payeeName: ownerUpiPayeeName || propertyName,
      amountPaise: bill.remaining_paise ?? bill.total_paise,
      note: `${bill.title} ${bill.month_label}`,
    });

    if (!upiUrl) {
      handleOpenPaymentModal(bill);
      return;
    }

    try {
      await Linking.openURL(upiUrl);
    } catch {
      // No UPI app installed or running on web browser
    }

    handleOpenPaymentModal(bill);
    showToast('Upload your payment screenshot after completing UPI transfer');
  };

  // Submit payment proof
  const handleSubmitPaymentProof = async () => {
    if (
      !selectedBillForPayment ||
      paymentProofMutation.isPending ||
      submittingProofRef.current ||
      !residentId
    ) {
      return;
    }

    const normalizedUtr =
      paymentMethod === 'upi' ? normalizeUpiUtr(referenceNumber) : null;
    if (paymentMethod === 'upi' && !normalizedUtr) {
      Alert.alert(
        'UTR Required',
        'Please enter the 12-digit UPI UTR / Transaction ID from your payment receipt.'
      );
      return;
    }

    submittingProofRef.current = true;
    const billTitle = selectedBillForPayment.title;
    try {
      await paymentProofMutation.mutateAsync({
        residentId,
        chargeId: selectedBillForPayment.charge_id,
        paymentMethod,
        referenceNumber:
          paymentMethod === 'upi' ? normalizedUtr ?? referenceNumber : referenceNumber,
        notes: studentNotes,
        screenshot: selectedScreenshot,
      });

      setPaymentModalVisible(false);
      setSelectedScreenshot(null);
      setReferenceNumber('');
      setStudentNotes('');
      showToast(`${billTitle} payment proof sent for review`);
    } catch (err) {
      Alert.alert(
        'Submission Error',
        err instanceof Error ? err.message : 'Could not send payment report.'
      );
    } finally {
      submittingProofRef.current = false;
    }
  };

  const headerSubtitle = roomNumber
    ? `${propertyName} · ${formatRoomLabel(roomNumber)}`
    : propertyName;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <OwnerHeader
        title="My Monthly Bills"
        subtitle={headerSubtitle}
        showBack
        onBack={() =>
          router.canGoBack() ? router.back() : router.replace('/resident-dashboard')
        }
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void handleRefresh()}
            colors={[OwnerTheme.colors.primary]}
          />
        }>
        {loading ? (
          <BillingSkeleton />
        ) : (
          <>
            <StudentChargeList
              currentRentBill={currentRentBill}
              currentEbBill={currentEbBill}
              unpaidBills={unpaidBills}
              breakdownExpanded={breakdownExpanded}
              ownerUpiId={ownerUpiId}
              ownerUpiPayeeName={ownerUpiPayeeName}
              propertyName={propertyName}
              withdrawingReportId={withdrawingReportId}
              onToggleBreakdown={() => setBreakdownExpanded((prev) => !prev)}
              onOpenPaymentModal={handleOpenPaymentModal}
              onPayNow={(bill) => void handlePayNow(bill)}
              onWithdrawProof={handleWithdrawProof}
              onOpenReceipt={(paymentId) =>
                router.push({
                  pathname: '/receipt-detail',
                  params: { id: paymentId },
                })
              }
            />

            {/* SECTION: PAID HISTORY (Hidden when empty) */}
            {pastBills.length > 0 && (
              <>
                <View style={[styles.sectionHeader, { marginTop: 24 }]}>
                  <Text style={styles.sectionTitle}>Past Months History</Text>
                </View>
                <View style={styles.historyList}>
                  {pastBills.map((bill) => (
                    <AllocationHistoryCard
                      key={bill.charge_id}
                      bill={bill}
                      onOpenReceipt={(paymentId) =>
                        router.push({
                          pathname: '/receipt-detail',
                          params: { id: paymentId },
                        })
                      }
                    />
                  ))}
                </View>
              </>
            )}
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Pay / Submit Proof Modal */}
      <PaymentProofModal
        visible={paymentModalVisible}
        selectedBill={selectedBillForPayment}
        currentRentBill={currentRentBill}
        currentEbBill={currentEbBill}
        unpaidBills={unpaidBills}
        paymentMethod={paymentMethod}
        referenceNumber={referenceNumber}
        studentNotes={studentNotes}
        selectedScreenshot={selectedScreenshot}
        submitting={submittingProof}
        onClose={() => setPaymentModalVisible(false)}
        onSelectBill={setSelectedBillForPayment}
        onChangePaymentMethod={setPaymentMethod}
        onChangeReferenceNumber={setReferenceNumber}
        onChangeStudentNotes={setStudentNotes}
        onPickScreenshot={() => void handlePickScreenshot()}
        onSubmit={() => void handleSubmitPaymentProof()}
      />

      <RoleBottomNav activeTab="bill" roleOverride="student" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: OwnerTheme.colors.background,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  loadingBox: {
    padding: 40,
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    fontSize: 13,
    color: '#64748B',
  },
  sectionHeader: {
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  historyList: {
    gap: 10,
  },
});
