import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { OwnerHeader } from '@/components/ui/owner';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/context/toast-context';
import { buildUpiPaymentUrl } from '@/lib/upi';
import { formatRoomLabel } from '@/lib/ux-utils';
import {
  getStudentBilling,
  PaymentMethod,
  StudentBillCardItem,
  StudentBillingSnapshot,
  submitStudentPaymentProof,
} from '@/services/billing.service';

export default function SimplifiedStudentBillingScreen() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const userId = user?.id;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [residentId, setResidentId] = useState<string | null>(null);
  const [roomNumber, setRoomNumber] = useState('');
  const [propertyName, setPropertyName] = useState('My PG');
  const [ownerUpiId, setOwnerUpiId] = useState<string | null>(null);
  const [ownerUpiPayeeName, setOwnerUpiPayeeName] = useState<string | null>(
    null
  );

  // Current Month Bills
  const [currentRentBill, setCurrentRentBill] =
    useState<StudentBillCardItem | null>(null);
  const [currentEbBill, setCurrentEbBill] =
    useState<StudentBillCardItem | null>(null);

  // Past Bills History
  const [pastBills, setPastBills] = useState<StudentBillCardItem[]>([]);
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
  const [submittingProof, setSubmittingProof] = useState(false);

  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const applySnapshot = useCallback((snapshot: StudentBillingSnapshot) => {
    setResidentId(snapshot.residentId);
    setRoomNumber(snapshot.roomNumber);
    setPropertyName(snapshot.propertyName);
    setOwnerUpiId(snapshot.ownerUpiId ?? null);
    setOwnerUpiPayeeName(snapshot.ownerUpiPayeeName ?? null);
    setCurrentRentBill(snapshot.currentRentBill);
    setCurrentEbBill(snapshot.currentEbBill);
    setPastBills(snapshot.pastBills);
  }, []);

  // Load student bills via SWR service
  const loadStudentBills = useCallback(
    async (options?: { forceNetwork?: boolean }) => {
      if (!userId) return;

      const reqId = ++requestIdRef.current;
      let hadCacheHit = false;

      const result = await getStudentBilling(userId, {
        forceNetwork: options?.forceNetwork,
        onCachedData: (cached) => {
          if (!mountedRef.current || requestIdRef.current !== reqId) return;
          hadCacheHit = true;
          applySnapshot(cached);
          setLoading(false);
        },
      });

      if (!mountedRef.current || requestIdRef.current !== reqId) return;

      if (result.ok) {
        applySnapshot(result.data);
      } else if (!hadCacheHit || options?.forceNetwork) {
        Alert.alert('Load Error', result.error.message);
      }

      setLoading(false);
      setRefreshing(false);
    },
    [userId, applySnapshot]
  );

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) {
        void loadStudentBills();
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [loadStudentBills]);

  const handleRefresh = () => {
    setRefreshing(true);
    void loadStudentBills({ forceNetwork: true });
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
        quality: 0.7,
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setSelectedScreenshot({
          uri: result.assets[0].uri,
          base64: result.assets[0].base64,
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
    if (!selectedBillForPayment || submittingProof || !residentId) return;

    setSubmittingProof(true);
    const result = await submitStudentPaymentProof({
      residentId,
      chargeId: selectedBillForPayment.charge_id,
      paymentMethod,
      referenceNumber,
      notes: studentNotes,
      screenshot: selectedScreenshot,
    });
    setSubmittingProof(false);

    if (!result.ok) {
      Alert.alert('Submission Error', result.error.message);
      return;
    }

    const billTitle = selectedBillForPayment.title;
    setPaymentModalVisible(false);
    setSelectedScreenshot(null);
    setReferenceNumber('');
    setStudentNotes('');
    showToast(`${billTitle} payment proof sent for review`);
    await loadStudentBills({ forceNetwork: true });
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
          router.canGoBack() ? router.back() : router.replace('/student-dashboard')
        }
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={['#0284C7']}
          />
        }>
        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color="#0284C7" />
            <Text style={styles.loadingText}>Loading your bills...</Text>
          </View>
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
    backgroundColor: '#F8FAFC',
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
