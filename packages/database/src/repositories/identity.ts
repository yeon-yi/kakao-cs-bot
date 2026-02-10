import { getSupabaseAdmin } from '../client';

export class IdentityRepository {
  private get db() { return getSupabaseAdmin(); }

  async findStaffByKakaoId(kakaoUserId: string) {
    const { data } = await this.db.from('company_staff').select('*').eq('kakao_user_id', kakaoUserId).eq('is_active', true).single();
    return data;
  }

  async findStaffByAlias(alias: string) {
    const { data } = await this.db.from('staff_aliases').select('*, staff:company_staff(*)').eq('alias', alias).single();
    return data;
  }

  async getRoomMember(roomId: string, userId: string) {
    const { data } = await this.db.from('room_members').select('*').eq('room_id', roomId).eq('user_id', userId).single();
    return data;
  }

  async upsertRoomMember(roomId: string, userId: string, userName: string | null, role: string, confidence: number) {
    const { data, error } = await this.db.from('room_members').upsert({
      room_id: roomId, user_id: userId, user_name: userName,
      role: role as any, confidence,
    }, { onConflict: 'room_id,user_id' }).select().single();
    if (error) throw error;
    return data;
  }

  async confirmIdentity(userId: string, roomId: string, role: string, confirmedBy: string) {
    const { error } = await this.db.from('room_members').update({
      role: role as any, confirmed_by: confirmedBy, confidence: 1.0,
    }).eq('room_id', roomId).eq('user_id', userId);
    if (error) throw error;
  }

  async listUnconfirmed() {
    const { data, error } = await this.db.from('room_members').select('*')
      .eq('role', 'unknown').order('joined_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  async registerStaff(input: { kakao_user_id?: string; kakao_name?: string; real_name: string; email?: string; phone?: string; department?: string; position?: string; added_by?: string }) {
    const { data, error } = await this.db.from('company_staff').insert(input as any).select().single();
    if (error) throw error;
    return data;
  }
}
