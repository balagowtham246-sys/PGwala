import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomTabInset } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/lib/supabase';

interface PropertyProfile {
  id: string;
  name: string;
  address: string | null;
  owner_id: string;
  is_active: boolean;
}

interface StudentResidentLink {
  id: string;
  property_id: string;
  full_name: string;
  room_number: string;
  phone_number: string | null;
  property?: {
    id: string;
    name: string;
    address: string | null;
    owner_id: string;
  } | null;
}

export default function SettingsTabScreen() {
  const { user, profile, signOut, refreshProfile } = useAuth();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Profile fields (shared)
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');

  // Owner Property configuration
  const [property, setProperty] = useState<PropertyProfile | null>(null);
  const [propertyName, setPropertyName] = useState('');
  const [propertyAddress, setPropertyAddress] = useState('');

  // Student linked info
  const [studentResident, setStudentResident] = useState<StudentResidentLink | null>(null);
  const [ownerContact, setOwnerContact] = useState<{ full_name: string; phone_number: string | null } | null>(null);

  // Load profile and relevant role-based settings
  const loadData = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }

    try {
      setErrorMessage(null);

      // 1. Initial user profile info
      if (profile) {
        setFullName(profile.full_name || '');
        setPhoneNumber(profile.phone_number || '');
      }

      if (profile?.role === 'owner') {
        // Fetch active property owned by this user
        const { data: propData, error: propErr } = await supabase
          .from('properties')
          .select('id, name, address, owner_id, is_active')
          .eq('owner_id', user.id)
          .eq('is_active', true)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (propErr) {
          console.warn('[Settings] Error fetching property:', propErr.message);
        } else if (propData) {
          setProperty(propData as PropertyProfile);
          setPropertyName(propData.name || '');
          setPropertyAddress(propData.address || '');
        }
      } else if (profile?.role === 'student') {
        // Fetch student's resident link
        const { data: resData, error: resErr } = await supabase
          .from('residents')
          .select(`
            id,
            property_id,
            full_name,
            room_number,
            phone_number,
            property:properties (
              id,
              name,
              address,
              owner_id
            )
          `)
          .eq('profile_id', user.id)
          .eq('is_active', true)
          .maybeSingle();

        if (resErr) {
          console.warn('[Settings] Error fetching student resident link:', resErr.message);
        } else if (resData) {
          const propObj = Array.isArray(resData.property) ? resData.property[0] : resData.property;
          setStudentResident({
            id: resData.id,
            property_id: resData.property_id,
            full_name: resData.full_name,
            room_number: resData.room_number,
            phone_number: resData.phone_number,
            property: propObj,
          });

          // Fetch owner's contact for student reference
          if (propObj?.owner_id) {
            const { data: ownerProf } = await supabase
              .from('profiles')
              .select('full_name, phone_number')
              .eq('id', propObj.owner_id)
              .maybeSingle();

            if (ownerProf) {
              setOwnerContact(ownerProf);
            }
          }
        }
      }
    } catch (err: any) {
      console.error('[Settings] Unexpected error:', err);
      setErrorMessage(err?.message || 'Failed to load settings data.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id, profile]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setSuccessMessage(null);
    loadData();
  }, [loadData]);

  // Handle saving personal profile (name & phone)
  const handleSaveProfile = async () => {
    if (!user?.id) return;
    const trimmedName = fullName.trim();
    if (!trimmedName) {
      setErrorMessage('Full name cannot be empty.');
      return;
    }

    try {
      setSaving(true);
      setErrorMessage(null);
      setSuccessMessage(null);

      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: trimmedName,
          phone_number: phoneNumber.trim() || null,
        })
        .eq('id', user.id);

      if (error) {
        throw new Error(error.message);
      }

      await refreshProfile();
      setSuccessMessage('Profile updated successfully.');
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to update profile.');
    } finally {
      setSaving(false);
    }
  };

  // Handle saving property details (for Owner)
  const handleSaveProperty = async () => {
    if (!property?.id || profile?.role !== 'owner') return;
    const trimmedPropName = propertyName.trim();
    if (!trimmedPropName) {
      setErrorMessage('PG / Property name cannot be empty.');
      return;
    }

    try {
      setSaving(true);
      setErrorMessage(null);
      setSuccessMessage(null);

      const { error } = await supabase
        .from('properties')
        .update({
          name: trimmedPropName,
          address: propertyAddress.trim() || null,
        })
        .eq('id', property.id)
        .eq('owner_id', user!.id);

      if (error) {
        throw new Error(error.message);
      }

      setProperty((prev) =>
        prev
          ? {
              ...prev,
              name: trimmedPropName,
              address: propertyAddress.trim() || null,
            }
          : null
      );
      setSuccessMessage('Property details updated successfully.');
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to update property details.');
    } finally {
      setSaving(false);
    }
  };

  // Action: Call Contact
  const handleCall = (numberToCall: string) => {
    const cleanNumber = numberToCall.replace(/[^0-9+]/g, '');
    Linking.openURL(`tel:${cleanNumber}`).catch(() => {
      Alert.alert('Unable to Call', `Could not initiate call to ${cleanNumber}`);
    });
  };

  // Action: WhatsApp Contact
  const handleWhatsApp = (numberToCall: string) => {
    const cleanNumber = numberToCall.replace(/[^0-9]/g, '');
    const url = `whatsapp://send?phone=${cleanNumber.startsWith('91') ? cleanNumber : `91${cleanNumber}`}`;
    Linking.openURL(url).catch(() => {
      Alert.alert('WhatsApp Unavailable', 'WhatsApp does not appear to be installed on this device.');
    });
  };

  // Handle Logout Confirmation
  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out of PGwala?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          try {
            await signOut();
            router.replace('/login');
          } catch (err: any) {
            Alert.alert('Sign Out Failed', err?.message || 'Could not sign out.');
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#0284C7" />
          <Text style={styles.loadingText}>Loading settings...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isOwner = profile?.role === 'owner';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          keyboardShouldPersistTaps="handled">
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.headerTitle}>Settings & Profile</Text>
              <Text style={styles.headerSubtitle}>
                {isOwner ? 'Manage your PG property and account' : 'View your room info & house guidelines'}
              </Text>
            </View>
            <View style={[styles.roleBadge, isOwner ? styles.ownerBadge : styles.studentBadge]}>
              <Text style={[styles.roleBadgeText, isOwner ? styles.ownerBadgeText : styles.studentBadgeText]}>
                {isOwner ? 'PG OWNER' : 'RESIDENT'}
              </Text>
            </View>
          </View>

          {/* Feedback Banners */}
          {errorMessage && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerIcon}>⚠️</Text>
              <Text style={styles.errorBannerText}>{errorMessage}</Text>
            </View>
          )}

          {successMessage && (
            <View style={styles.successBanner}>
              <Text style={styles.successBannerIcon}>✓</Text>
              <Text style={styles.successBannerText}>{successMessage}</Text>
            </View>
          )}

          {/* ============================================================== */}
          {/* OWNER SECTION: PROPERTY DETAILS                                */}
          {/* ============================================================== */}
          {isOwner && (
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderRow}>
                <View style={styles.sectionIconWrap}>
                  <Text style={styles.sectionIcon}>🏢</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sectionCardTitle}>PG Property Profile</Text>
                  <Text style={styles.sectionCardSubtitle}>
                    Official name and location shown on resident receipts
                  </Text>
                </View>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>PG / Hostel Name</Text>
                <TextInput
                  style={styles.input}
                  value={propertyName}
                  onChangeText={setPropertyName}
                  placeholder="e.g. Sunrise Luxury Men's PG"
                  placeholderTextColor="#94A3B8"
                  autoCapitalize="words"
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>Physical Address</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={propertyAddress}
                  onChangeText={setPropertyAddress}
                  placeholder="e.g. #42, 2nd Cross, Near Tech Park, Whitefield, Bengaluru"
                  placeholderTextColor="#94A3B8"
                  multiline
                  numberOfLines={3}
                />
              </View>

              <Pressable
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.buttonPressed,
                  saving && styles.buttonDisabled,
                ]}
                disabled={saving}
                onPress={handleSaveProperty}>
                {saving ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryButtonText}>Save Property Details</Text>
                )}
              </Pressable>
            </View>
          )}

          {/* ============================================================== */}
          {/* STUDENT SECTION: ACCOMMODATION & OWNER CONTACT                 */}
          {/* ============================================================== */}
          {!isOwner && (
            <>
              {studentResident ? (
                <View style={styles.sectionCard}>
                  <View style={styles.sectionHeaderRow}>
                    <View style={styles.sectionIconWrap}>
                      <Text style={styles.sectionIcon}>🛏️</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.sectionCardTitle}>My Accommodation</Text>
                      <Text style={styles.sectionCardSubtitle}>Current assigned room & PG location</Text>
                    </View>
                  </View>

                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>PG Name</Text>
                    <Text style={styles.infoValue}>
                      {studentResident.property?.name || 'Assigned PG'}
                    </Text>
                  </View>

                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Assigned Room</Text>
                    <Text style={styles.infoValueHighlight}>Room {studentResident.room_number}</Text>
                  </View>

                  {studentResident.property?.address && (
                    <View style={styles.infoRow}>
                      <Text style={styles.infoLabel}>Address</Text>
                      <Text style={[styles.infoValue, { flex: 1, textAlign: 'right' }]}>
                        {studentResident.property.address}
                      </Text>
                    </View>
                  )}

                  {/* Owner / Warden Contact Details */}
                  {ownerContact && (
                    <View style={styles.ownerContactBox}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.contactTitle}>PG Caretaker / Owner</Text>
                        <Text style={styles.contactName}>{ownerContact.full_name}</Text>
                        {ownerContact.phone_number && (
                          <Text style={styles.contactPhone}>{ownerContact.phone_number}</Text>
                        )}
                      </View>

                      {ownerContact.phone_number && (
                        <View style={styles.contactActions}>
                          <Pressable
                            style={styles.iconBtnCall}
                            onPress={() => handleCall(ownerContact.phone_number!)}>
                            <Text style={styles.iconBtnText}>📞 Call</Text>
                          </Pressable>
                          <Pressable
                            style={styles.iconBtnWhatsApp}
                            onPress={() => handleWhatsApp(ownerContact.phone_number!)}>
                            <Text style={styles.iconBtnText}>💬 WhatsApp</Text>
                          </Pressable>
                        </View>
                      )}
                    </View>
                  )}
                </View>
              ) : (
                <View style={styles.unlinkedCard}>
                  <Text style={styles.unlinkedIcon}>ℹ️</Text>
                  <Text style={styles.unlinkedTitle}>Unlinked Account</Text>
                  <Text style={styles.unlinkedText}>
                    Your account has not yet been linked to an active room by your PG owner.
                  </Text>
                </View>
              )}

              {/* House Guidelines & Rules Card */}
              <View style={styles.sectionCard}>
                <View style={styles.sectionHeaderRow}>
                  <View style={styles.sectionIconWrap}>
                    <Text style={styles.sectionIcon}>📜</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sectionCardTitle}>PG Rules & Guidelines</Text>
                    <Text style={styles.sectionCardSubtitle}>General policies & mess timings</Text>
                  </View>
                </View>

                <View style={styles.ruleItem}>
                  <Text style={styles.ruleBullet}>•</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.ruleTitle}>Gate Curfew (10:30 PM)</Text>
                    <Text style={styles.ruleDesc}>
                      Main gates close at 10:30 PM. All gate movements after 10:30 PM must be pre-approved by the warden.
                    </Text>
                  </View>
                </View>

                <View style={styles.ruleItem}>
                  <Text style={styles.ruleBullet}>•</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.ruleTitle}>Mess Timings</Text>
                    <Text style={styles.ruleDesc}>
                      Breakfast: 7:30 AM – 9:30 AM{'\n'}
                      Lunch: 12:30 PM – 2:30 PM{'\n'}
                      Dinner: 8:00 PM – 10:00 PM
                    </Text>
                  </View>
                </View>

                <View style={styles.ruleItem}>
                  <Text style={styles.ruleBullet}>•</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.ruleTitle}>Quiet Hours (11:00 PM – 6:00 AM)</Text>
                    <Text style={styles.ruleDesc}>
                      Maintain respectful silence in corridors and rooms for studying and sleeping residents.
                    </Text>
                  </View>
                </View>

                <View style={styles.ruleItem}>
                  <Text style={styles.ruleBullet}>•</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.ruleTitle}>Electricity & Geyser Conservation</Text>
                    <Text style={styles.ruleDesc}>
                      Please turn off ACs, lights, and water heaters before leaving your room.
                    </Text>
                  </View>
                </View>
              </View>
            </>
          )}

          {/* ============================================================== */}
          {/* PERSONAL ACCOUNT INFORMATION (Name, Phone, Email)             */}
          {/* ============================================================== */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeaderRow}>
              <View style={styles.sectionIconWrap}>
                <Text style={styles.sectionIcon}>👤</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionCardTitle}>Personal Profile</Text>
                <Text style={styles.sectionCardSubtitle}>
                  Contact details linked to your PGwala account
                </Text>
              </View>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Full Name</Text>
              <TextInput
                style={styles.input}
                value={fullName}
                onChangeText={setFullName}
                placeholder="Enter your name"
                placeholderTextColor="#94A3B8"
                autoCapitalize="words"
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Phone Number</Text>
              <TextInput
                style={styles.input}
                value={phoneNumber}
                onChangeText={setPhoneNumber}
                placeholder="e.g. 9876543210"
                placeholderTextColor="#94A3B8"
                keyboardType="phone-pad"
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Registered Email (Read-only)</Text>
              <TextInput
                style={[styles.input, styles.disabledInput]}
                value={user?.email || 'No email registered'}
                editable={false}
              />
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.buttonPressed,
                saving && styles.buttonDisabled,
              ]}
              disabled={saving}
              onPress={handleSaveProfile}>
              {saving ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryButtonText}>Save Profile</Text>
              )}
            </Pressable>
          </View>

          {/* ============================================================== */}
          {/* APPLICATION INFO & SIGN OUT                                    */}
          {/* ============================================================== */}
          <View style={styles.sectionCard}>
            <View style={styles.appInfoRow}>
              <Text style={styles.appInfoTitle}>PGwala Mobile</Text>
              <Text style={styles.appInfoVersion}>v1.0.0 (Production Build)</Text>
            </View>
            <Text style={styles.appInfoDesc}>
              Smart PG & Hostel Management Platform with real-time gate logs, automated billing, and instant maintenance ticketing.
            </Text>

            <View style={styles.divider} />

            <Pressable
              style={({ pressed }) => [styles.signOutButton, pressed && styles.buttonPressed]}
              onPress={handleSignOut}>
              <Text style={styles.signOutButtonText}>🚪 Sign Out</Text>
            </Pressable>
          </View>

          {/* Bottom inset padding */}
          <View style={{ height: BottomTabInset + 40 }} />
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: '#64748B',
    fontWeight: '500',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  roleBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  roleBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  ownerBadge: {
    backgroundColor: '#E0F2FE',
  },
  ownerBadgeText: {
    color: '#0369A1',
  },
  studentBadge: {
    backgroundColor: '#FEF3C7',
  },
  studentBadgeText: {
    color: '#B45309',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    padding: 12,
    borderRadius: 10,
    marginBottom: 14,
    gap: 8,
  },
  errorBannerIcon: {
    fontSize: 16,
  },
  errorBannerText: {
    flex: 1,
    fontSize: 12,
    color: '#B91C1C',
    fontWeight: '600',
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#6EE7B7',
    padding: 12,
    borderRadius: 10,
    marginBottom: 14,
    gap: 8,
  },
  successBannerIcon: {
    fontSize: 16,
    color: '#059669',
    fontWeight: '800',
  },
  successBannerText: {
    flex: 1,
    fontSize: 12,
    color: '#047857',
    fontWeight: '600',
  },
  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 16,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 3,
      },
      android: {
        elevation: 1,
      },
    }),
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    gap: 12,
  },
  sectionIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#F0F9FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionIcon: {
    fontSize: 18,
  },
  sectionCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  sectionCardSubtitle: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  formGroup: {
    marginBottom: 12,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 6,
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
  textArea: {
    minHeight: 65,
    textAlignVertical: 'top',
  },
  disabledInput: {
    backgroundColor: '#F1F5F9',
    color: '#94A3B8',
  },
  primaryButton: {
    backgroundColor: '#0284C7',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  infoLabel: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '500',
  },
  infoValue: {
    fontSize: 13,
    color: '#0F172A',
    fontWeight: '600',
  },
  infoValueHighlight: {
    fontSize: 13,
    color: '#0284C7',
    fontWeight: '700',
  },
  ownerContactBox: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  contactTitle: {
    fontSize: 10,
    fontWeight: '700',
    color: '#166534',
    textTransform: 'uppercase',
  },
  contactName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#14532D',
    marginTop: 2,
  },
  contactPhone: {
    fontSize: 12,
    color: '#15803D',
    marginTop: 1,
  },
  contactActions: {
    flexDirection: 'row',
    gap: 6,
  },
  iconBtnCall: {
    backgroundColor: '#059669',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
  },
  iconBtnWhatsApp: {
    backgroundColor: '#10B981',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
  },
  iconBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  ruleItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
    gap: 8,
  },
  ruleBullet: {
    fontSize: 16,
    color: '#0284C7',
    lineHeight: 18,
  },
  ruleTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
  },
  ruleDesc: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
    lineHeight: 17,
  },
  unlinkedCard: {
    backgroundColor: '#FFFBEB',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#FDE68A',
    marginBottom: 16,
    alignItems: 'center',
  },
  unlinkedIcon: {
    fontSize: 24,
    marginBottom: 6,
  },
  unlinkedTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#92400E',
  },
  unlinkedText: {
    fontSize: 12,
    color: '#B45309',
    textAlign: 'center',
    marginTop: 2,
    lineHeight: 16,
  },
  appInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  appInfoTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  appInfoVersion: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  appInfoDesc: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 4,
    lineHeight: 16,
  },
  divider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 14,
  },
  signOutButton: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutButtonText: {
    color: '#DC2626',
    fontSize: 14,
    fontWeight: '700',
  },
});
