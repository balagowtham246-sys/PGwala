import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Linking,
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
} from '@/hooks/use-student-billing';
import { compressPickedImage } from '@/lib/image-upload';
import { buildUpiPaymentUrl } from '@/lib/upi';
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
  const pastBills = snapshot?.pastBills ?? [];
  const submittingProof = paymentProofMutation.isPending;

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
    try {
      await billingQuery.refetch();
    } finally {
      setManualRefreshing(false);
    }
  };

  // Launch Image Picker to choose screenshot proof
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
        allowsEditing: true,
        quality: 0.85,
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
      amountPaise: bill.total_paise,
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

    submittingProofRef.current = true;
    const billTitle = selectedBillForPayment.title;
    try {
      await paymentProofMutation.mutateAsync({
        residentId,
        chargeId: selectedBillForPayment.charge_id,
        paymentMethod,
        referenceNumber,
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
              breakdownExpanded={breakdownExpanded}
              ownerUpiId={ownerUpiId}
              ownerUpiPayeeName={ownerUpiPayeeName}
              propertyName={propertyName}
              onToggleBreakdown={() => setBreakdownExpanded((prev) => !prev)}
              onOpenPaymentModal={handleOpenPaymentModal}
              onPayNow={(bill) => void handlePayNow(bill)}
              onOpenReceipt={(paymentId) =>
                router.push({
                  pathname: '/receipt-detail',
                  params: { id: paymentId },
                })
              }
            />

            {/* SECTION: PAST MONTHS HISTORY (Hidden when empty) */}
            {pastBills.length > 0 && (
              <>
                <View style={[styles.sectionHeader, { marginTop: 24 }]}>
                  <Text style={styles.sectionTitle}>Past Months History</Text>
                </View>
                <View style={styles.historyList}>
                  {pastBills.map((bill) => (
                    <AllocationHistoryCard key={bill.charge_id} bill={bill} />
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
