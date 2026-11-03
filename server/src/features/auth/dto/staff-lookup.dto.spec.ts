import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { StaffLookupDto } from './staff-lookup.dto';

describe('StaffLookupDto', () => {
  const valid = {
    person_empid: '00123',
    person_name: '王小明',
    person_status: 1,
    person_status_name: '正式',
    department_id: 'D001',
    department_name: '資訊部',
    title: '工程師',
  };

  it('接受登入所需白名單欄位', async () => {
    await expect(
      validate(plainToInstance(StaffLookupDto, valid)),
    ).resolves.toEqual([]);
  });

  it.each([
    { person_empid: '00123-' },
    { person_empid: 'x'.repeat(33) },
    { person_name: '' },
    { person_name: undefined },
    { person_name: 'x'.repeat(101) },
    { person_status: 2 },
    { person_status_name: '離職' },
    { department_id: 'bad value' },
    { department_id: 'x'.repeat(51) },
    { department_name: 'x'.repeat(151) },
    { title: 'x'.repeat(101) },
  ])('拒絕不合法欄位：%p', async (override) => {
    const errors = await validate(
      plainToInstance(StaffLookupDto, { ...valid, ...override }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });
});
