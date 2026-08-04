-- 0058_referral_cap_bonus :: down
-- Полный откат. Ни политик, ни грантов снимать не нужно — колонка наследовала
-- постуру profile. Бэкфилл восстановим при повторном up (referral-строки живут
-- своей жизнью и статус 'rewarded' не теряется).

ALTER TABLE profile DROP COLUMN IF EXISTS referral_cap_bonus;
