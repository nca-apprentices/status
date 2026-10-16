-- The incidents from before the Worker recorded them, taken from the open
-- and close times of their issues in nca-apprentices/infra. Each issue
-- opened or closed at the end of the run that started or ended its incident,
-- so each time is up to a minute late.
INSERT INTO incidents (monitor, started, ended)
VALUES
  ('ncaleague', 1791669692000, 1791670233000), -- infra#96
  ('jjforge', 1791669692000, 1791670293000), -- infra#97
  ('alerts', 1791669872000, 1791670235000), -- infra#98
  ('ncaleague', 1791708212000, 1791708573000), -- infra#115
  ('jjforge', 1791708213000, 1791708574000), -- infra#116
  ('alerts', 1791708332000, 1791708513000) -- infra#119
ON CONFLICT DO NOTHING;
