import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AuthUser, IS_PUBLIC_KEY, Role, ROLES_KEY } from '../common/roles';

/**
 * Applied to every endpoint (see app.module.ts).
 * 1. Checks the "Authorization: Bearer <token>" header, unless the endpoint is @Public().
 * 2. If the endpoint has @Roles(...), checks the user's role (FR12).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const request = context.switchToHttp().getRequest();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('Please log in');

    let user: AuthUser;
    try {
      user = await this.jwt.verifyAsync<AuthUser>(token);
    } catch {
      throw new UnauthorizedException('Session expired, please log in again');
    }
    request.user = user;

    const allowed = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, targets);
    if (allowed?.length && user.role !== Role.ADMIN && !allowed.includes(user.role)) {
      throw new ForbiddenException('Your role cannot use this function');
    }
    return true;
  }
}
