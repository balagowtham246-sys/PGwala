import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Building2, MapPin, DoorClosed, Clock, Shield, CheckCircle2 } from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/lib/supabase';
import { OwnerHeader, EmptyState } from '@/components/ui/owner';

interface AccommodationData {
  roomNumber: string;
  propertyName: string;
  propertyAddress: string | null;
  ownerName?: string | null;
  ownerPhone?: string | null;
}

export default function ResidentAccommodationScreen() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [accommodation, setAccommodation] = useState<AccommodationData | null>(null);

  useEffect(() => {
    (async () => {
      if (!user?.id) return;
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from('residents')
          .select(`
            room_number,
            property:properties (
              name,
              address,
              owner_id
            )
          `)
          .eq('profile_id', user.id)
          .eq('is_active', true)
          .maybeSingle();

        if (error) throw error;

        if (data) {
          const prop = Array.isArray(data.property) ? data.property[0] : data.property;
          let ownerName: string | null = null;
          let ownerPhone: string | null = null;

          if (prop?.owner_id) {
            const { data: ownerData } = await supabase
              .from('profiles')
              .select('full_name, phone_number')
              .eq('id', prop.owner_id)
              .maybeSingle();

            if (ownerData) {
              ownerName = ownerData.full_name;
              ownerPhone = ownerData.phone_number;
            }
          }

          setAccommodation({
            roomNumber: data.room_number,
            propertyName: prop?.name || 'Assigned PG',
            propertyAddress: prop?.address || null,
            ownerName,
            ownerPhone,
          });
        }
      } catch (err: any) {
        console.warn('Failed to load accommodation:', err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [user?.id]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <OwnerHeader
        title="My Accommodation"
        subtitle="Assigned room and PG facility details"
        showBack
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color={OwnerTheme.colors.primary} />
            <Text style={styles.loadingText}>Loading accommodation...</Text>
          </View>
        ) : !accommodation ? (
          <EmptyState
            title="Awaiting Room Allocation"
            description="Your resident profile has not yet been linked to a room by your PG owner."
          />
        ) : (
          <>
            {/* Primary Room Card */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Building2 size={20} color={OwnerTheme.colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.propertyName}>{accommodation.propertyName}</Text>
                  {accommodation.propertyAddress ? (
                    <View style={styles.addressRow}>
                      <MapPin size={13} color={OwnerTheme.colors.textMuted} />
                      <Text style={styles.addressText} numberOfLines={1}>
                        {accommodation.propertyAddress}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.activeBadge}>
                  <CheckCircle2 size={13} color="#FFFFFF" />
                  <Text style={styles.activeBadgeText}>ACTIVE</Text>
                </View>
              </View>

              <View style={styles.divider} />

              <View style={styles.detailsGrid}>
                <View style={styles.detailCol}>
                  <Text style={styles.detailLabel}>Assigned Room</Text>
                  <Text style={styles.detailValue}>Room {accommodation.roomNumber}</Text>
                </View>
                <View style={styles.detailCol}>
                  <Text style={styles.detailLabel}>Resident Status</Text>
                  <Text style={[styles.detailValue, { color: OwnerTheme.colors.success }]}>
                    Enrolled Resident
                  </Text>
                </View>
              </View>
            </View>

            {/* Management Contact Card */}
            {accommodation.ownerName ? (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Shield size={18} color={OwnerTheme.colors.primary} />
                  <Text style={styles.cardTitle}>PG Management & Warden</Text>
                </View>

                <View style={styles.contactRow}>
                  <Text style={styles.contactLabel}>Administrator:</Text>
                  <Text style={styles.contactValue}>{accommodation.ownerName}</Text>
                </View>
                {accommodation.ownerPhone ? (
                  <View style={styles.contactRow}>
                    <Text style={styles.contactLabel}>Phone:</Text>
                    <Text style={styles.contactValue}>{accommodation.ownerPhone}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* Resident Guidelines Card */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Clock size={18} color={OwnerTheme.colors.textPrimary} />
                <Text style={styles.cardTitle}>Resident Guidelines</Text>
              </View>

              <View style={styles.ruleItem}>
                <Text style={styles.ruleBullet}>•</Text>
                <Text style={styles.ruleText}>
                  <Text style={styles.ruleBold}>Gate Attendance:</Text> Mark Going Out whenever you leave the PG premises and confirm your dinner requirement.
                </Text>
              </View>

              <View style={styles.ruleItem}>
                <Text style={styles.ruleBullet}>•</Text>
                <Text style={styles.ruleText}>
                  <Text style={styles.ruleBold}>Washing Machine:</Text> Please mark the machine as FREE once your wash cycle completes so fellow residents can use it.
                </Text>
              </View>

              <View style={styles.ruleItem}>
                <Text style={styles.ruleBullet}>•</Text>
                <Text style={styles.ruleText}>
                  <Text style={styles.ruleBold}>Maintenance:</Text> Report room issues promptly via the Complaints tab for rapid resolution.
                </Text>
              </View>
            </View>
          </>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
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
    gap: 14,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
  },
  loadingBox: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 8,
    fontSize: 13,
    color: OwnerTheme.colors.textSecondary,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  propertyName: {
    fontSize: 16,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  addressText: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
  },
  activeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: OwnerTheme.colors.success,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: OwnerTheme.radius.full,
  },
  activeBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  divider: {
    height: 1,
    backgroundColor: OwnerTheme.colors.borderLight,
    marginVertical: 14,
  },
  detailsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  detailCol: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 12,
    color: OwnerTheme.colors.textMuted,
  },
  detailValue: {
    fontSize: 15,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
    marginTop: 4,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  contactRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: OwnerTheme.colors.borderLight,
  },
  contactLabel: {
    fontSize: 13,
    color: OwnerTheme.colors.textSecondary,
  },
  contactValue: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  ruleItem: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  ruleBullet: {
    fontSize: 14,
    color: OwnerTheme.colors.primary,
    fontWeight: '800',
  },
  ruleText: {
    flex: 1,
    fontSize: 13,
    color: OwnerTheme.colors.textSecondary,
    lineHeight: 18,
  },
  ruleBold: {
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
});

