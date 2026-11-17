import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { DatabaseService } from '../database/database.service';
import { AuthUser, CurrentUser, Role, Roles } from '../common/roles';
import { insertRow, updateRow } from '../common/sql';
import { AuthService, PASSWORD_RULE, PASSWORD_RULE_MESSAGE } from '../auth/auth.service';

export class CreateUserDto {
  @IsString() @IsNotEmpty() @MaxLength(80) full_name: string;
  @Matches(/^[a-z0-9._]{3,30}$/, { message: 'Username: 3-30 lowercase letters, digits, dots or underscores' })
  username: string;
  @IsEnum(Role) role: Role;
  @Matches(/^\+?[0-9]{9,14}$/, { message: 'Phone must be 9 to 14 digits' }) phone: string;
  @Matches(PASSWORD_RULE, { message: PASSWORD_RULE_MESSAGE }) password: string;
}

export class UpdateUserDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) full_name?: string;
  @IsOptional() @IsEnum(Role) role?: Role;
  @IsOptional() @Matches(/^\+?[0-9]{9,14}$/, { message: 'Phone must be 9 to 14 digits' }) phone?: string;
  @IsOptional() @IsBoolean() is_active?: boolean;
}

export class ResetPasswordDto {
  @Matches(PASSWORD_RULE, { message: PASSWORD_RULE_MESSAGE }) password: string;
}

const PUBLIC_COLUMNS = `user_id, full_name, username, role, phone, is_active, last_login`;

/** UC10 Manage users and roles. Admin only. */
@Controller()
@Roles(Role.ADMIN)
export class UsersController {
  constructor(private readonly db: DatabaseService) {}

  /** GET /api/users */
  @Get('users')
  list() {
    return this.db.query(`SELECT ${PUBLIC_COLUMNS} FROM app_user ORDER BY role, full_name`);
  }

  /** POST /api/users - create with a temporary password */
  @Post('users')
  async create(@Body() dto: CreateUserDto, @CurrentUser() admin: AuthUser) {
    const password_hash = await AuthService.hashPassword(dto.password);
    const row = await this.db.transaction(admin.userId, (c) =>
      insertRow(c, 'app_user', { ...dto, username: dto.username.toLowerCase(), password_hash }, [
        'full_name', 'username', 'role', 'phone', 'password_hash',
      ]),
    );
    delete row.password_hash;
    return row;
  }

  /** PATCH /api/users/:id - change name, role, phone, or deactivate */
  @Patch('users/:id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserDto, @CurrentUser() admin: AuthUser) {
    // An admin must not lock themselves out.
    if (id === admin.userId && (dto.is_active === false || (dto.role && dto.role !== Role.ADMIN))) {
      throw new BadRequestException('You cannot deactivate yourself or remove your own Admin role');
    }
    const row = await this.db.transaction(admin.userId, (c) =>
      updateRow(c, 'app_user', 'user_id', id, { ...dto }, ['full_name', 'role', 'phone', 'is_active']),
    );
    delete row.password_hash;
    return row;
  }

  /** POST /api/users/:id/reset-password - set a new temporary password */
  @Post('users/:id/reset-password')
  @HttpCode(200)
  async resetPassword(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResetPasswordDto,
    @CurrentUser() admin: AuthUser,
  ) {
    const password_hash = await AuthService.hashPassword(dto.password);
    await this.db.transaction(admin.userId, (c) =>
      updateRow(c, 'app_user', 'user_id', id, { password_hash }, ['password_hash']),
    );
    return { message: 'Password reset' };
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
