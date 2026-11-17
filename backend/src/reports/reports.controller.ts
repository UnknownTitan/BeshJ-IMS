import { BadRequestException, Controller, Get, Param, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { AuthUser, CurrentUser, Role, Roles } from '../common/roles';
import { ExportService } from './export.service';
import { ReportParams, ReportsService } from './reports.service';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** UC8 Dashboard and reports (FR11). */
@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService, private readonly exporter: ExportService) {}

  /** GET /api/dashboard - key figures, pending work and chart series (everyone logged in) */
  @Get('dashboard')
  dashboard() {
    return this.reports.dashboard();
  }

  /** GET /api/reports/:name?from=2026-11-01&to=2026-11-30&groupBy=brand&days=30 */
  @Get('reports/:name')
  @Roles(Role.WAREHOUSE_MANAGER, Role.ACCOUNTANT, Role.MANAGEMENT)
  run(@Param('name') name: string, @Query() q: Record<string, string>) {
    return this.reports.run(name, this.params(q));
  }

  /** GET /api/reports/:name/export?format=xlsx|pdf&... - download the same report as a file */
  @Get('reports/:name/export')
  @Roles(Role.WAREHOUSE_MANAGER, Role.ACCOUNTANT, Role.MANAGEMENT)
  async export(@Param('name') name: string, @Query() q: Record<string, string>, @CurrentUser() u: AuthUser, @Res() res: Response) {
    const format = q.format ?? 'xlsx';
    if (!['xlsx', 'pdf'].includes(format)) throw new BadRequestException('format must be xlsx or pdf');
    const report = await this.reports.run(name, this.params(q));
    const file = format === 'xlsx' ? await this.exporter.xlsx(report, u.fullName) : await this.exporter.pdf(report, u.fullName);
    const filename = `besh-${name}-${new Date().toISOString().slice(0, 10)}.${format}`;
    res
      .status(200)
      .set({
        'Content-Type': format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(file.length),
      })
      .send(file);
  }

  private params(q: Record<string, string>): ReportParams {
    for (const k of ['from', 'to']) {
      if (q[k] && !DATE.test(q[k])) throw new BadRequestException(`${k} must be a date like 2026-11-30`);
    }
    return { from: q.from, to: q.to, groupBy: q.groupBy, days: q.days ? Number(q.days) : undefined };
  }
}
