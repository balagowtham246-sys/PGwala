import {
  InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';

import {
  ActiveResidentOption,
  ComplaintCategory,
  ComplaintPriority,
  ComplaintStatus,
  OwnerComplaintItem,
} from '@/components/complaints/OwnerComplaintsModals';
import { StudentComplaintItem } from '@/components/complaints/StudentComplaintModals';
import { uploadStorageWithRetry } from '@/lib/image-upload';
import { queryKeys } from '@/lib/query-keys';
import { broadcastPropertySync } from '@/lib/realtime-sync';
import { decodeBase64ToBytes, supabase } from '@/lib/supabase';
import { sortRoomCodes } from '@/lib/ux-utils';

export const COMPLAINTS_PAGE_SIZE = 30;

export interface OwnerComplaintsPage {
  propertyId: string | null;
  propertyName: string;
  complaints: OwnerComplaintItem[];
  activeResidents: ActiveResidentOption[];
  hasMore: boolean;
}

const OWNER_COMPLAINT_SELECT = `
  id,
  property_id,
  resident_id,
  category,
  priority,
  status,
  title,
  description,
  photo_url,
  owner_notes,
  resolved_at,
  created_at,
  resident:residents (
    full_name,
    room_number,
    phone_number
  )
`;

export function useOwnerComplaintsQuery(params: {
  userId: string | undefined;
  selectedPropertyId: string | null;
  selectedPropertyName?: string;
}) {
  const { userId, selectedPropertyId, selectedPropertyName } = params;
  const queryKey = queryKeys.complaints.owner(selectedPropertyId ?? 'auto');

  return useInfiniteQuery<
    OwnerComplaintsPage,
    Error,
    InfiniteData<OwnerComplaintsPage>,
    typeof queryKey,
    number
  >({
    queryKey,
    enabled: Boolean(userId),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage.hasMore) return undefined;
      return allPages.reduce((sum, p) => sum + p.complaints.length, 0);
    },
    queryFn: async ({ pageParam }) => {
      let activePropId = selectedPropertyId;
      let activePropName = selectedPropertyName;

      if (!activePropId) {
        const { data: propData, error: propError } = await supabase
          .from('properties')
          .select('id, name')
          .eq('owner_id', userId!)
          .eq('is_active', true)
          .order('created_at', { ascending: true })
          .limit(1);

        if (propError) throw propError;
        if (!propData || propData.length === 0) {
          return {
            propertyId: null,
            propertyName: activePropName || 'My PG',
            complaints: [],
            activeResidents: [],
            hasMore: false,
          };
        }

        activePropId = propData[0].id;
        activePropName = propData[0].name;
      }

      const rangeEnd = pageParam + COMPLAINTS_PAGE_SIZE - 1;
      const complaintsPromise = supabase
        .from('complaints')
        .select(OWNER_COMPLAINT_SELECT)
        .eq('property_id', activePropId)
        .order('created_at', { ascending: false })
        .range(pageParam, rangeEnd);

      if (pageParam > 0) {
        const compRes = await complaintsPromise;
        if (compRes.error) throw compRes.error;
        const page = (compRes.data as unknown as OwnerComplaintItem[]) || [];
        return {
          propertyId: activePropId,
          propertyName: activePropName || 'My PG',
          complaints: page,
          activeResidents: [],
          hasMore: page.length >= COMPLAINTS_PAGE_SIZE,
        };
      }

      const [compRes, residentsRes] = await Promise.all([
        complaintsPromise,
        supabase
          .from('residents')
          .select('id, full_name, room_number')
          .eq('property_id', activePropId)
          .eq('is_active', true),
      ]);

      if (compRes.error) throw compRes.error;

      const sortedResidents = residentsRes.error
        ? []
        : [...((residentsRes.data as ActiveResidentOption[]) || [])].sort(
            (a, b) => {
              const roomCmp = sortRoomCodes(a.room_number, b.room_number);
              if (roomCmp !== 0) return roomCmp;
              return a.full_name.localeCompare(b.full_name);
            }
          );

      const page = (compRes.data as unknown as OwnerComplaintItem[]) || [];
      return {
        propertyId: activePropId,
        propertyName: activePropName || 'My PG',
        complaints: page,
        activeResidents: sortedResidents,
        hasMore: page.length >= COMPLAINTS_PAGE_SIZE,
      };
    },
  });
}

export interface OwnerCreateComplaintInput {
  propertyId: string;
  residentId: string;
  residentSnapshot: { full_name: string; room_number: string };
  category: ComplaintCategory;
  priority: ComplaintPriority;
  title: string;
  description: string;
}

interface OwnerComplaintsMutationContext {
  previousQueries: [readonly unknown[], InfiniteData<OwnerComplaintsPage> | undefined][];
  optimisticId?: string;
}

export function useOwnerCreateComplaintMutation() {
  const qc = useQueryClient();

  return useMutation<
    OwnerComplaintItem,
    Error,
    OwnerCreateComplaintInput,
    OwnerComplaintsMutationContext
  >({
    mutationFn: async (input) => {
      const { data, error } = await supabase
        .from('complaints')
        .insert({
          property_id: input.propertyId,
          resident_id: input.residentId,
          category: input.category,
          priority: input.priority,
          title: input.title.trim(),
          description: input.description.trim(),
          status: 'open',
        })
        .select(OWNER_COMPLAINT_SELECT)
        .single();

      if (error) throw error;
      return data as unknown as OwnerComplaintItem;
    },
    onMutate: async (variables) => {
      await qc.cancelQueries({ queryKey: queryKeys.complaints.all });
      const previousQueries = qc.getQueriesData<InfiniteData<OwnerComplaintsPage>>({
        queryKey: ['complaints', 'owner'],
      });
      const optimisticId = `optimistic-owner-${Date.now()}`;

      const optimisticItem: OwnerComplaintItem = {
        id: optimisticId,
        property_id: variables.propertyId,
        resident_id: variables.residentId,
        category: variables.category,
        priority: variables.priority,
        status: 'open',
        title: variables.title.trim(),
        description: variables.description.trim(),
        photo_url: null,
        owner_notes: null,
        resolved_at: null,
        created_at: new Date().toISOString(),
        resident: {
          full_name: variables.residentSnapshot.full_name,
          room_number: variables.residentSnapshot.room_number,
          phone_number: null,
        },
      };

      for (const [key, data] of previousQueries) {
        if (!data || data.pages.length === 0) continue;
        qc.setQueryData<InfiniteData<OwnerComplaintsPage>>(key, {
          ...data,
          pages: data.pages.map((page, idx) =>
            idx === 0
              ? { ...page, complaints: [optimisticItem, ...page.complaints] }
              : page
          ),
        });
      }

      return { previousQueries, optimisticId };
    },
    onSuccess: (serverRow, _variables, context) => {
      if (!context?.optimisticId) return;
      const currentQueries = qc.getQueriesData<InfiniteData<OwnerComplaintsPage>>({
        queryKey: ['complaints', 'owner'],
      });
      for (const [key, data] of currentQueries) {
        if (!data) continue;
        qc.setQueryData<InfiniteData<OwnerComplaintsPage>>(key, {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            complaints: page.complaints.map((c) =>
              c.id === context.optimisticId ? serverRow : c
            ),
          })),
        });
      }
    },
    onError: (_err, _variables, context) => {
      if (!context) return;
      for (const [key, snapshot] of context.previousQueries) {
        qc.setQueryData(key, snapshot);
      }
    },
    onSettled: (_data, err) => {
      if (!err) broadcastPropertySync('complaints');
      void qc.invalidateQueries({ queryKey: queryKeys.complaints.all });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    },
  });
}

export interface OwnerUpdateComplaintInput {
  id: string;
  status: ComplaintStatus;
  ownerNotes: string | null;
  resolvedAt: string | null;
}

export function useOwnerUpdateComplaintMutation() {
  const qc = useQueryClient();

  return useMutation<
    OwnerComplaintItem,
    Error,
    OwnerUpdateComplaintInput,
    OwnerComplaintsMutationContext
  >({
    mutationFn: async (input) => {
      const { data, error } = await supabase
        .from('complaints')
        .update({
          status: input.status,
          owner_notes: input.ownerNotes,
          resolved_at: input.resolvedAt,
        })
        .eq('id', input.id)
        .select(OWNER_COMPLAINT_SELECT)
        .single();

      if (error) throw error;
      return data as unknown as OwnerComplaintItem;
    },
    onMutate: async (variables) => {
      await qc.cancelQueries({ queryKey: queryKeys.complaints.all });
      const previousQueries = qc.getQueriesData<InfiniteData<OwnerComplaintsPage>>({
        queryKey: ['complaints', 'owner'],
      });

      for (const [key, data] of previousQueries) {
        if (!data) continue;
        qc.setQueryData<InfiniteData<OwnerComplaintsPage>>(key, {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            complaints: page.complaints.map((c) =>
              c.id === variables.id
                ? {
                    ...c,
                    status: variables.status,
                    owner_notes: variables.ownerNotes,
                    resolved_at: variables.resolvedAt,
                  }
                : c
            ),
          })),
        });
      }

      return { previousQueries };
    },
    onSuccess: (serverRow) => {
      const currentQueries = qc.getQueriesData<InfiniteData<OwnerComplaintsPage>>({
        queryKey: ['complaints', 'owner'],
      });
      for (const [key, data] of currentQueries) {
        if (!data) continue;
        qc.setQueryData<InfiniteData<OwnerComplaintsPage>>(key, {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            complaints: page.complaints.map((c) =>
              c.id === serverRow.id ? serverRow : c
            ),
          })),
        });
      }
    },
    onError: (_err, _variables, context) => {
      if (!context) return;
      for (const [key, snapshot] of context.previousQueries) {
        qc.setQueryData(key, snapshot);
      }
    },
    onSettled: (_data, err) => {
      if (!err) broadcastPropertySync('complaints');
      void qc.invalidateQueries({ queryKey: queryKeys.complaints.all });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    },
  });
}

const STUDENT_COMPLAINT_SELECT =
  'id, property_id, resident_id, category, priority, status, title, description, photo_url, owner_notes, resolved_at, created_at';

export interface StudentComplaintsPage {
  complaints: StudentComplaintItem[];
  hasMore: boolean;
}

export function useStudentComplaintsQuery(residentId: string | undefined) {
  const queryKey = queryKeys.complaints.student(residentId ?? '');

  return useInfiniteQuery<
    StudentComplaintsPage,
    Error,
    InfiniteData<StudentComplaintsPage>,
    typeof queryKey,
    number
  >({
    queryKey,
    enabled: Boolean(residentId),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage.hasMore) return undefined;
      return allPages.reduce((sum, p) => sum + p.complaints.length, 0);
    },
    queryFn: async ({ pageParam }) => {
      const rangeEnd = pageParam + COMPLAINTS_PAGE_SIZE - 1;
      const { data, error } = await supabase
        .from('complaints')
        .select(STUDENT_COMPLAINT_SELECT)
        .eq('resident_id', residentId!)
        .order('created_at', { ascending: false })
        .range(pageParam, rangeEnd);

      if (error) throw error;
      const page = (data as StudentComplaintItem[]) || [];
      return {
        complaints: page,
        hasMore: page.length >= COMPLAINTS_PAGE_SIZE,
      };
    },
  });
}

export interface StudentCreateComplaintInput {
  propertyId: string;
  residentId: string;
  category: ComplaintCategory;
  priority: ComplaintPriority;
  title: string;
  description: string;
  selectedPhoto: { uri: string; base64?: string | null } | null;
}

interface StudentComplaintsMutationContext {
  previous: InfiniteData<StudentComplaintsPage> | undefined;
  optimisticId: string;
  queryKey: ReturnType<typeof queryKeys.complaints.student>;
}

export class PhotoUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhotoUploadError';
  }
}

export function useStudentCreateComplaintMutation() {
  const qc = useQueryClient();

  return useMutation<
    StudentComplaintItem,
    Error,
    StudentCreateComplaintInput,
    StudentComplaintsMutationContext
  >({
    mutationFn: async (input) => {
      let uploadedPhotoPath: string | null = null;

      if (input.selectedPhoto?.base64) {
        const fileExt =
          input.selectedPhoto.uri.split('.').pop()?.toLowerCase() || 'jpg';
        const fileName = `${input.residentId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${fileExt}`;
        const bytes = decodeBase64ToBytes(input.selectedPhoto.base64);

        const { error: uploadError } = await uploadStorageWithRetry({
          bucket: 'complaint-photos',
          path: fileName,
          bytes,
          fileUri: input.selectedPhoto.uri,
          contentType: `image/${fileExt === 'png' ? 'png' : 'jpeg'}`,
          upsert: false,
          maxAttempts: 2,
        });

        if (uploadError) {
          throw new PhotoUploadError(
            `Photo upload failed: ${uploadError.message}`
          );
        }
        uploadedPhotoPath = fileName;
      }

      const { data, error } = await supabase
        .from('complaints')
        .insert({
          property_id: input.propertyId,
          resident_id: input.residentId,
          category: input.category,
          priority: input.priority,
          title: input.title,
          description: input.description,
          photo_url: uploadedPhotoPath,
        })
        .select(STUDENT_COMPLAINT_SELECT)
        .single();

      if (error) throw error;
      return data as StudentComplaintItem;
    },
    onMutate: async (variables) => {
      const queryKey = queryKeys.complaints.student(variables.residentId);
      await qc.cancelQueries({ queryKey: queryKeys.complaints.all });
      const previous =
        qc.getQueryData<InfiniteData<StudentComplaintsPage>>(queryKey);
      const optimisticId = `optimistic-student-${Date.now()}`;

      const optimisticItem: StudentComplaintItem = {
        id: optimisticId,
        property_id: variables.propertyId,
        resident_id: variables.residentId,
        category: variables.category,
        priority: variables.priority,
        status: 'open',
        title: variables.title,
        description: variables.description,
        photo_url: null,
        owner_notes: null,
        resolved_at: null,
        created_at: new Date().toISOString(),
      };

      if (previous && previous.pages.length > 0) {
        qc.setQueryData<InfiniteData<StudentComplaintsPage>>(queryKey, {
          ...previous,
          pages: previous.pages.map((page, idx) =>
            idx === 0
              ? { ...page, complaints: [optimisticItem, ...page.complaints] }
              : page
          ),
        });
      } else {
        qc.setQueryData<InfiniteData<StudentComplaintsPage>>(queryKey, {
          pages: [{ complaints: [optimisticItem], hasMore: false }],
          pageParams: [0],
        });
      }

      return { previous, optimisticId, queryKey };
    },
    onSuccess: (serverRow, _variables, context) => {
      if (!context) return;
      const current =
        qc.getQueryData<InfiniteData<StudentComplaintsPage>>(context.queryKey);
      if (!current) return;

      qc.setQueryData<InfiniteData<StudentComplaintsPage>>(context.queryKey, {
        ...current,
        pages: current.pages.map((page) => ({
          ...page,
          complaints: page.complaints.map((c) =>
            c.id === context.optimisticId ? serverRow : c
          ),
        })),
      });
    },
    onError: (_err, _variables, context) => {
      if (!context) return;
      qc.setQueryData(context.queryKey, context.previous);
    },
    onSettled: (_data, err) => {
      if (!err) broadcastPropertySync('complaints');
      void qc.invalidateQueries({ queryKey: queryKeys.complaints.all });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    },
  });
}
