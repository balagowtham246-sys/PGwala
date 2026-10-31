import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { useAuth } from '@/context/auth-context';
import { supabase } from '@/lib/supabase';

interface RoomResident {
  id: string;
  full_name: string;
  room_number: string;
  is_active: boolean;
}

interface SplitPreviewItem {
  id: string;
  full_name: string;
  room_number: string;
  shareRupees: number;
}

export default function EbBillingScreen() {
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [propertyName, setPropertyName] = useState('My PG');

  // Available rooms and residents in the property
  const [allResidents, setAllResidents] = useState<RoomResident[]>([]);
  const [availableRooms, setAvailableRooms] = useState<string[]>([]);

  // Form Fields
  const [selectedRoom, setSelectedRoom] = useState<string>('');
  const [totalBillRupees, setTotalBillRupees] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');

  // Selected residents for this room's bill (checkboxes)
  const [selectedResidentIds, setSelectedResidentIds] = useState<string[]>([]);

  // Allocation calculation & review step
  const [submitting, setSubmitting] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [splitPreview, setSplitPreview] = useState<SplitPreviewItem[]>([]);

  // Load property and residents
  const loadData = useCallback(async () => {
    try {
      setLoading(true);

      const { data: properties, error: propError } = await supabase
        .from('properties')
        .select('id, name')
        .eq('is_active', true)
        .limit(1);

      if (propError) throw propError;
      if (!properties || properties.length === 0) {
        setLoading(false);
        return;
      }

      const activeProp = properties[0];
      setPropertyId(activeProp.id);
      setPropertyName(activeProp.name);

      // Fetch active residents
      const { data: resData, error: resError } = await supabase
        .from('residents')
        .select('id, full_name, room_number, is_active')
        .eq('property_id', activeProp.id)
        .eq('is_active', true)
        .order('room_number', { ascending: true });

      if (resError) throw resError;

      const loadedResidents: RoomResident[] = resData || [];
      setAllResidents(loadedResidents);

      // Extract unique room numbers
      const roomsSet = new Set<string>();
      loadedResidents.forEach((r) => {
        if (r.room_number) roomsSet.add(r.room_number);
      });
      const roomsList = Array.from(roomsSet).sort();
      setAvailableRooms(roomsList);

      if (roomsList.length > 0) {
        setSelectedRoom(roomsList[0]);
      }

      // Default dates
      const now = new Date();
      const endIso = now.toISOString().split('T')[0];
      const startD = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      const startIso = startD.toISOString().split('T')[0];

      // Next 5th
      let next5thMonth = now.getMonth();
      let next5thYear = now.getFullYear();
      if (now.getDate() >= 5) {
        next5thMonth += 1;
        if (next5thMonth > 11) {
          next5thMonth = 0;
          next5thYear += 1;
        }
      }
      const dueIso = `${next5thYear}-${String(next5thMonth + 1).padStart(2, '0')}-05`;

      setPeriodStart(startIso);
      setPeriodEnd(endIso);
      setDueDate(dueIso);
    } catch (err: any) {
      console.error('[EbBilling] Load error:', err);
      Alert.alert('Load Failed', err.message || 'Could not load room details.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // When selected room changes, auto-select all residents currently in that room
  useEffect(() => {
    if (!selectedRoom) return;
    const roomRes = allResidents.filter((r) => r.room_number === selectedRoom);
    setSelectedResidentIds(roomRes.map((r) => r.id));
    setShowReview(false);
  }, [selectedRoom, allResidents]);

  // Toggle resident selection checkbox
  const toggleResident = (resId: string) => {
    setSelectedResidentIds((prev) =>
      prev.includes(resId) ? prev.filter((id) => id !== resId) : [...prev, resId]
    );
    setShowReview(false);
  };

  // Calculate Whole-Rupee Deterministic Split Preview
  const handleProceedToReview = () => {
    const totalRupees = parseInt(totalBillRupees, 10);
    if (isNaN(totalRupees) || totalRupees <= 0) {
      Alert.alert('Invalid Bill Amount', 'Please enter a valid whole rupee amount.');
      return;
    }

    if (selectedResidentIds.length === 0) {
      Alert.alert('No Residents Selected', 'Please select at least one resident to share this bill.');
      return;
    }

    if (!periodStart || !periodEnd || !dueDate) {
      Alert.alert('Dates Required', 'Please ensure billing start, end, and due dates are filled.');
      return;
    }

    const n = selectedResidentIds.length;
    const baseRupees = Math.floor(totalRupees / n);
    const remainderRupees = totalRupees % n;

    // Filter and sort chosen residents deterministically
    const chosenResidents = allResidents
      .filter((r) => selectedResidentIds.includes(r.id))
      .sort((a, b) => a.full_name.localeCompare(b.full_name));

    const preview: SplitPreviewItem[] = chosenResidents.map((r, index) => ({
      id: r.id,
      full_name: r.full_name,
      room_number: r.room_number,
      shareRupees: index < remainderRupees ? baseRupees + 1 : baseRupees,
    }));

    setSplitPreview(preview);
    setShowReview(true);
  };

  // Confirm and Execute RPC allocation
  const handleConfirmAllocation = async () => {
    if (!propertyId) return;

    const totalRupees = parseInt(totalBillRupees, 10);
    const totalPaise = totalRupees * 100;

    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('allocate_eb_bill', {
        p_property_id: propertyId,
        p_room_number: selectedRoom,
        p_period_start: periodStart,
        p_period_end: periodEnd,
        p_due_date: dueDate,
        p_total_amount_paise: totalPaise,
        p_resident_ids: splitPreview.map((p) => p.id),
        p_notes: notes.trim() || null,
      });

      if (error) throw error;

      if (!data?.success) {
        Alert.alert('Allocation Failed', data?.error || 'Could not allocate electricity bill.');
        return;
      }

      Alert.alert('Bill Allocated Successfully', data.message, [
        {
          text: 'Done',
          onPress: () => router.back(),
        },
      ]);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to allocate EB bill.');
    } finally {
      setSubmitting(false);
    }
  };

  const roomResidents = allResidents.filter((r) => r.room_number === selectedRoom);

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          {/* Header */}
          <View style={styles.topBar}>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
              onPress={() => router.back()}>
              <Text style={styles.backButtonText}>‹ Back</Text>
            </Pressable>
            <View style={styles.headerTitleWrap}>
              <Text style={styles.screenTitle}>EB Room Bill Entry</Text>
              <Text style={styles.screenSubtitle}>{propertyName}</Text>
            </View>
          </View>

          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="small" color="#0284C7" />
              <Text style={styles.loadingText}>Loading room and resident data...</Text>
            </View>
          ) : (
            <>
              {/* Form Card */}
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Bill Details</Text>
                <Text style={styles.cardSub}>
                  Enter the electricity bill for a room. The system will divide it equally in whole rupees and record an immutable snapshot.
                </Text>

                {/* Room Selector */}
                <Text style={styles.fieldLabel}>Select Room</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.roomPillScroll}>
                  {availableRooms.map((room) => (
                    <Pressable
                      key={room}
                      style={[styles.roomPill, selectedRoom === room && styles.roomPillActive]}
                      onPress={() => setSelectedRoom(room)}>
                      <Text style={[styles.roomPillText, selectedRoom === room && styles.roomPillTextActive]}>
                        Room {room}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>

                {/* Total Bill Amount in Rupees */}
                <View style={styles.inputGroup}>
                  <Text style={styles.fieldLabel}>Total Room Bill Amount (₹)</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="numeric"
                    placeholder="e.g. 1850"
                    placeholderTextColor="#94A3B8"
                    value={totalBillRupees}
                    onChangeText={(val) => {
                      setTotalBillRupees(val);
                      setShowReview(false);
                    }}
                  />
                </View>

                {/* Bill Period & Due Date */}
                <View style={styles.dateRow}>
                  <View style={[styles.inputGroup, { flex: 1 }]}>
                    <Text style={styles.fieldLabel}>Period Start</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="YYYY-MM-DD"
                      value={periodStart}
                      onChangeText={setPeriodStart}
                    />
                  </View>
                  <View style={[styles.inputGroup, { flex: 1 }]}>
                    <Text style={styles.fieldLabel}>Period End</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="YYYY-MM-DD"
                      value={periodEnd}
                      onChangeText={setPeriodEnd}
                    />
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.fieldLabel}>Due Date</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="YYYY-MM-DD"
                    value={dueDate}
                    onChangeText={setDueDate}
                  />
                </View>

                {/* Meter Reading / Notes */}
                <View style={styles.inputGroup}>
                  <Text style={styles.fieldLabel}>Notes / Meter Reading (Optional)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. Units: 240 kWh @ ₹7.7"
                    placeholderTextColor="#94A3B8"
                    value={notes}
                    onChangeText={setNotes}
                  />
                </View>
              </View>

              {/* Residents Checklist Card */}
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Eligible Residents for Room {selectedRoom}</Text>
                <Text style={styles.cardSub}>
                  Select residents who resided in this room during the billing period.
                </Text>

                {roomResidents.length === 0 ? (
                  <Text style={styles.emptyText}>No active residents currently assigned to this room.</Text>
                ) : (
                  roomResidents.map((r) => {
                    const isSelected = selectedResidentIds.includes(r.id);
                    return (
                      <Pressable
                        key={r.id}
                        style={[styles.residentCheckRow, isSelected && styles.residentCheckRowSelected]}
                        onPress={() => toggleResident(r.id)}>
                        <View style={[styles.checkbox, isSelected && styles.checkboxActive]}>
                          {isSelected && <Text style={styles.checkmark}>✓</Text>}
                        </View>
                        <Text style={styles.residentCheckName}>{r.full_name}</Text>
                      </Pressable>
                    );
                  })
                )}

                {!showReview && (
                  <Pressable style={styles.reviewBtn} onPress={handleProceedToReview}>
                    <Text style={styles.reviewBtnText}>Review Split Allocation ›</Text>
                  </Pressable>
                )}
              </View>

              {/* Review & Confirmation Step */}
              {showReview && (
                <View style={styles.reviewCard}>
                  <Text style={styles.reviewCardTitle}>Review Allocation Shares</Text>
                  <Text style={styles.reviewCardSub}>
                    Total Bill: ₹{totalBillRupees} divided among {splitPreview.length} residents in whole rupees.
                  </Text>

                  {splitPreview.map((item, idx) => (
                    <View key={item.id} style={styles.previewRow}>
                      <Text style={styles.previewName}>
                        {idx + 1}. {item.full_name}
                      </Text>
                      <Text style={styles.previewShare}>₹{item.shareRupees}</Text>
                    </View>
                  ))}

                  <View style={styles.sumCheckRow}>
                    <Text style={styles.sumCheckLabel}>Sum of Shares:</Text>
                    <Text style={styles.sumCheckValue}>
                      ₹{splitPreview.reduce((acc, curr) => acc + curr.shareRupees, 0)} (Matches ₹{totalBillRupees})
                    </Text>
                  </View>

                  <Pressable
                    disabled={submitting}
                    style={[styles.confirmBtn, submitting && styles.btnDisabled]}
                    onPress={handleConfirmAllocation}>
                    {submitting ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <Text style={styles.confirmBtnText}>Confirm & Post EB Charges</Text>
                    )}
                  </Pressable>
                </View>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 40,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  backButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginRight: 12,
  },
  backButtonPressed: {
    backgroundColor: '#F1F5F9',
  },
  backButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  headerTitleWrap: {
    flex: 1,
  },
  screenTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  screenSubtitle: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  loadingBox: {
    padding: 30,
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    fontSize: 13,
    color: '#64748B',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  cardSub: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 18,
    marginTop: 4,
    marginBottom: 14,
  },
  roomPillScroll: {
    flexDirection: 'row',
    marginBottom: 14,
  },
  roomPill: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  roomPillActive: {
    backgroundColor: '#0284C7',
    borderColor: '#0284C7',
  },
  roomPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  roomPillTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
  },
  inputGroup: {
    marginBottom: 14,
  },
  input: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0F172A',
  },
  dateRow: {
    flexDirection: 'row',
    gap: 10,
  },
  residentCheckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  residentCheckRowSelected: {
    backgroundColor: '#F0F9FF',
    borderRadius: 6,
    paddingHorizontal: 6,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#94A3B8',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  checkboxActive: {
    backgroundColor: '#0284C7',
    borderColor: '#0284C7',
  },
  checkmark: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  residentCheckName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  emptyText: {
    fontSize: 13,
    color: '#94A3B8',
    fontStyle: 'italic',
    paddingVertical: 8,
  },
  reviewBtn: {
    backgroundColor: '#0284C7',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  reviewBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  reviewCard: {
    backgroundColor: '#F0F9FF',
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: '#BAE6FD',
    marginBottom: 20,
  },
  reviewCardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0369A1',
  },
  reviewCardSub: {
    fontSize: 12,
    color: '#0284C7',
    marginTop: 2,
    marginBottom: 12,
  },
  previewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E0F2FE',
  },
  previewName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0F172A',
  },
  previewShare: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0369A1',
  },
  sumCheckRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: 2,
    borderTopColor: '#BAE6FD',
  },
  sumCheckLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0369A1',
  },
  sumCheckValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#15803D',
  },
  confirmBtn: {
    backgroundColor: '#16A34A',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  confirmBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  btnDisabled: {
    opacity: 0.6,
  },
});
