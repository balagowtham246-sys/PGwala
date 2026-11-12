import React, { useEffect, useState } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Linking,
  ScrollView,
} from 'react-native';
import { AlertTriangle, Download } from 'lucide-react-native';
import { checkAppVersion, VersionCheckResult } from '@/lib/version-check';

export function UpdateGuard() {
  const [versionState, setVersionState] = useState<VersionCheckResult | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    checkAppVersion('android').then((res) => {
      if (res.isOutdated) {
        setVersionState(res);
      }
    });
  }, []);

  if (!versionState || !versionState.isOutdated) {
    return null;
  }

  // If update is optional and user dismissed it
  if (!versionState.isMandatory && dismissed) {
    return null;
  }

  const handleDownload = async () => {
    if (versionState.apkDownloadUrl) {
      const supported = await Linking.canOpenURL(versionState.apkDownloadUrl);
      if (supported) {
        await Linking.openURL(versionState.apkDownloadUrl);
      }
    }
  };

  return (
    <Modal
      visible={true}
      transparent={true}
      animationType="fade"
      onRequestClose={() => {
        if (!versionState.isMandatory) {
          setDismissed(true);
        }
      }}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconContainer}>
            <AlertTriangle size={36} color="#DC2626" />
          </View>

          <Text style={styles.title}>
            {versionState.isMandatory ? 'Update Required' : 'New Version Available'}
          </Text>

          <Text style={styles.description}>
            {versionState.isMandatory
              ? 'A critical update is required to continue using PGwala securely without interruption.'
              : 'A newer version of PGwala is ready with improvements and bug fixes.'}
          </Text>

          <View style={styles.versionBadgeContainer}>
            <View style={styles.badge}>
              <Text style={styles.badgeLabel}>Installed</Text>
              <Text style={styles.badgeValue}>v{versionState.currentVersion}</Text>
            </View>
            <View style={[styles.badge, styles.badgeHighlight]}>
              <Text style={styles.badgeLabel}>Latest</Text>
              <Text style={[styles.badgeValue, styles.badgeHighlightText]}>
                v{versionState.latestVersion}
              </Text>
            </View>
          </View>

          {versionState.releaseNotes ? (
            <ScrollView style={styles.notesContainer}>
              <Text style={styles.notesHeader}>{"What's New:"}</Text>
              <Text style={styles.notesText}>{versionState.releaseNotes}</Text>
            </ScrollView>
          ) : null}

          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={styles.downloadButton}
              activeOpacity={0.8}
              onPress={handleDownload}
            >
              <Download size={20} color="#FFFFFF" style={styles.buttonIcon} />
              <Text style={styles.downloadButtonText}>Download & Install Update</Text>
            </TouchableOpacity>

            {!versionState.isMandatory && (
              <TouchableOpacity
                style={styles.dismissButton}
                activeOpacity={0.7}
                onPress={() => setDismissed(true)}
              >
                <Text style={styles.dismissButtonText}>Remind Me Later</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FEE2E2',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 8,
    textAlign: 'center',
  },
  description: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
  },
  versionBadgeContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  badge: {
    backgroundColor: '#F1F5F9',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  badgeHighlight: {
    backgroundColor: '#E0F2FE',
  },
  badgeLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '500',
    textTransform: 'uppercase',
  },
  badgeValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#334155',
    marginTop: 2,
  },
  badgeHighlightText: {
    color: '#0284C7',
  },
  notesContainer: {
    maxHeight: 100,
    width: '100%',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  notesHeader: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 4,
  },
  notesText: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 18,
  },
  buttonContainer: {
    width: '100%',
    gap: 10,
  },
  downloadButton: {
    backgroundColor: '#0284C7',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonIcon: {
    marginRight: 8,
  },
  downloadButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  dismissButton: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  dismissButtonText: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '500',
  },
});

