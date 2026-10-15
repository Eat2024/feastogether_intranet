import { HttpStatus } from '@nestjs/common';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { AppException } from '#app/common/errors/app.exception';
import { EsignSignerCandidateService } from './esign-signer-candidate.service';

describe('EsignSignerCandidateService', () => {
  const manager = {} as never;
  const empid = '11506071';
  const staff = {
    person_empid: empid,
    person_name: '陳柏丞',
    department_id: 'D003',
    department_name: '系統維運部',
    title: '工程師',
    person_status: 1,
    person_status_name: '正式',
  };

  function setup(options: { found?: object[]; existing?: object } = {}) {
    const users = {
      findActiveCandidates: jest.fn(async () => options.found ?? []),
      findByEmpidForUpdate: jest.fn(async () => options.existing ?? null),
      findByEmpid: jest.fn(async () => null),
      create: jest.fn((value: object) => value),
      save: jest.fn(async (value: object) => ({ id: 31, ...value })),
    };
    const mysql = {
      getManager: jest.fn(() => manager),
      transaction: jest.fn((run: (value: never) => Promise<unknown>) =>
        run(manager),
      ),
    };
    const hr = { lookupEligibleStaff: jest.fn(async () => staff) };
    const service = new EsignSignerCandidateService(
      users as never,
      mysql as never,
      hr as never,
    );
    return { service, users, hr };
  }

  it('本地已有該員編時不呼叫饗賓人 API', async () => {
    const local = { id: 7, empid, name: '陳柏丞', isActive: true };
    const { service, hr } = setup({ found: [local] });

    await expect(service.list(empid)).resolves.toEqual([local]);
    expect(hr.lookupEligibleStaff).not.toHaveBeenCalled();
  });

  it('本地查無完整員編時向饗賓人 API 查詢，並比照登入流程建立帳號', async () => {
    const { service, users, hr } = setup();

    const result = await service.list(` ${empid} `);

    expect(hr.lookupEligibleStaff).toHaveBeenCalledWith(empid);
    expect(users.create).toHaveBeenCalledWith(
      {
        empid,
        name: '陳柏丞',
        isActive: true,
        personStatus: '正式',
        departmentName: '系統維運部',
        titleName: '工程師',
      },
      manager,
    );
    expect(result).toEqual([expect.objectContaining({ id: 31, empid })]);
  });

  it.each([undefined, '', '陳', '1150', 'dev001', '115060711'])(
    '查詢不是完整八碼員編（%p）時不呼叫饗賓人 API',
    async (query) => {
      const { service, hr } = setup();
      await service.list(query);
      expect(hr.lookupEligibleStaff).not.toHaveBeenCalled();
    },
  );

  it('饗賓人 API 查無此人或資格不符時回傳空清單，不建立帳號', async () => {
    const { service, users, hr } = setup();
    hr.lookupEligibleStaff.mockRejectedValueOnce(
      new AppException(
        AppErrorCode.AUTH_EXCHANGE_FAILED,
        '無法完成登入交換',
        HttpStatus.UNAUTHORIZED,
      ),
    );

    await expect(service.list(empid)).resolves.toEqual([]);
    expect(users.save).not.toHaveBeenCalled();
  });

  it('饗賓人 API 連線失敗時照常拋出錯誤', async () => {
    const { service, hr } = setup();
    hr.lookupEligibleStaff.mockRejectedValueOnce(
      new AppException(
        AppErrorCode.STAFF_LOOKUP_FAILED,
        '系統有錯，請詢問IT部門',
        HttpStatus.BAD_GATEWAY,
      ),
    );

    await expect(service.list(empid)).rejects.toMatchObject({
      code: AppErrorCode.STAFF_LOOKUP_FAILED,
    });
  });

  it('本地帳號已停用時不重新啟用', async () => {
    const { service, users } = setup({
      existing: { id: 9, empid, name: '陳柏丞', isActive: false },
    });

    await expect(service.list(empid)).resolves.toEqual([]);
    expect(users.save).not.toHaveBeenCalled();
  });
});
