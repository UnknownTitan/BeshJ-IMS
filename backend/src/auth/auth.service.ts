import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { DatabaseService } from '../database/database.service';
import { AuthUser, Role } from '../common/roles';

interface UserRow {
  user_id: number;
  username: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  password_hash: string;
}

@Injectable()
export class AuthService {
  constructor(private readonly db: DatabaseService, private readonly jwt: JwtService) {}

  async login(username: string, password: string) {
    const user = await this.db.one<UserRow>(
      `SELECT user_id, username, full_name, role, is_active, password_hash
         FROM app_user WHERE username = $1`,
      [username.trim().toLowerCase()],
    );

    // Same message for "no such user" and "wrong password" so attackers can't probe usernames.
    if (!user || !user.is_active || !(await bcrypt.compare(password, user.password_hash))) {
      throw new UnauthorizedException('Invalid username or password');
    }

    await this.db.transaction(user.user_id, async (c) => {
      await c.query(`UPDATE app_user SET last_login = CURRENT_TIMESTAMP WHERE user_id = $1`, [user.user_id]);
      await c.query(
        `INSERT INTO audit_log (table_name, operation, record_key, user_id) VALUES ('app_user', 'LOGIN', $1::text, $1::int)`,
        [user.user_id],
      );
    });

    const payload: AuthUser = {
      userId: user.user_id,
      username: user.username,
      fullName: user.full_name,
      role: user.role,
    };
    return { accessToken: await this.jwt.signAsync(payload), user: payload };
  }

  /** Users change their own password; the current one must be correct. */
  async changePassword(userId: number, current: string, next: string) {
    const row = await this.db.one<{ password_hash: string }>(
      `SELECT password_hash FROM app_user WHERE user_id = $1`,
      [userId],
    );
    if (!row || !(await bcrypt.compare(current, row.password_hash))) {
      throw new BadRequestException('Current password is incorrect');
    }
    if (current === next) throw new BadRequestException('Choose a password you have not just used');
    const hash = await AuthService.hashPassword(next);
    await this.db.transaction(userId, (c) =>
      c.query(`UPDATE app_user SET password_hash = $1 WHERE user_id = $2`, [hash, userId]),
    );
    return { message: 'Password changed' };
  }

  static hashPassword(plain: string) {
    return bcrypt.hash(plain, 10);
  }
}

/** At least 8 characters with a letter and a digit. */
export const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*[0-9]).{8,72}$/;
export const PASSWORD_RULE_MESSAGE = 'Password must be at least 8 characters and include a letter and a number';
