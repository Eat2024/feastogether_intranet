-- 僅供受控的一次性維護；執行前先備份並核對影響 key，交易由維護人控制。
-- 只插入缺少規則；既有列（包含已撤銷列）與備註均不變，不在服務啟動時執行。
INSERT INTO mail_recipient_whitelist (`type`, `value`, `remark`)
SELECT initial_rule.`type`, initial_rule.`value`, initial_rule.`remark`
FROM (
  SELECT 'department' AS `type`, '1029030000' AS `value`, 'IT策略本部系統開發部' AS `remark`
  UNION ALL SELECT 'department', '1029090000', 'IT策略本部系統開發二部'
  UNION ALL SELECT 'department', '1029010000', 'IT策略本部資訊安全部'
  UNION ALL SELECT 'employee', '09005001', '額外允許同仁'
) AS initial_rule
WHERE NOT EXISTS (
  SELECT 1 FROM mail_recipient_whitelist AS existing_rule
  WHERE existing_rule.`type` = initial_rule.`type` COLLATE utf8mb4_0900_bin
    AND existing_rule.`value` = initial_rule.`value` COLLATE utf8mb4_0900_bin
);
