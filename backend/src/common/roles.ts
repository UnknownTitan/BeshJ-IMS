import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';

/** The seven roles from the app_user.role CHECK constraint (Assignment 7). */
export enum Role {
  ADMIN = 'ADMIN',
  WAREHOUSE_MANAGER = 'WAREHOUSE_MANAGER',
  STORE_KEEPER = 'STORE_KEEPER',
  SALES_REP = 'SALES_REP',
  DRIVER = 'DRIVER',
  ACCOUNTANT = 'ACCOUNTANT',
  MANAGEMENT = 'MANAGEMENT',
}

/** What the JWT carries about the logged-in user. */
export interface AuthUser {
  userId: number;
  username: string;
  fullName: string;
  role: Role;
}

export const ROLES_KEY = 'roles';
/** Restrict an endpoint to the listed roles. ADMIN is always allowed. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const IS_PUBLIC_KEY = 'isPublic';
/** Mark an endpoint as reachable without logging in. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Inject the logged-in user into a controller method. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);
