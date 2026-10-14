import { Controller, Get, Query } from '@nestjs/common';
import { UserRepository } from '#app/features/users/repositories/user.repository';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';

@Controller('esign/signer-candidates')
export class SignerCandidatesController {
  constructor(
    private readonly users: UserRepository,
    private readonly mysql: MysqlService,
  ) {}

  @Get()
  async list(@Query('q') query?: string) {
    const users = await this.users.findActiveCandidates(
      query?.slice(0, 100),
      this.mysql.getManager(),
    );
    return users.map((user) => ({
      id: String(user.id),
      employeeNo: user.empid,
      name: user.name,
      department: user.departmentName ?? null,
      title: user.titleName ?? null,
    }));
  }
}
