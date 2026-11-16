import { Controller, Get, Query } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { Role, Roles } from '../common/roles';

/** UC10 Manage users and roles. Admin only. Create/edit come in Phase 1. */
@Controller()
@Roles(Role.ADMIN)
export class UsersController {
  constructor(private readonly db: DatabaseService) {}

  /** GET /api/users */
  @Get('users')
  list() {
    return this.db.query(
      `SELECT user_id, full_name, username, role, phone, is_active, last_login
         FROM app_user ORDER BY role, full_name`,
    );
  }

  /** GET /api/audit-log?table=product&limit=100 - FR12 audit trail */
  @Get('audit-log')
  @Roles(Role.ADMIN, Role.MANAGEMENT)
  audit(@Query('table') table?: string, @Query('limit') limit = '100') {
    return this.db.query(
      `SELECT a.audit_id, a.changed_at, a.table_name, a.operation, a.record_key,
              u.full_name AS changed_by, a.old_data, a.new_data
         FROM audit_log a LEFT JOIN app_user u ON u.user_id = a.user_id
        WHERE ($1::text IS NULL OR a.table_name = $1)
        ORDER BY a.audit_id DESC
        LIMIT LEAST($2::int, 500)`,
      [table || null, Number(limit) || 100],
    );
  }
}
