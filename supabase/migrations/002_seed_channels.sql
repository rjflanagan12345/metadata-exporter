-- ============================================================
-- 002_seed_channels.sql
-- Seed 31 distribution channels
-- ============================================================

INSERT INTO channels (name, region, onix_version, delivery_method, active, image_delivery, notes) VALUES
-- ONIX 2.1
('Adams Book Co. Inc.',          'US',    '2.1',         'sftp', true,  'url', NULL),
('Anchor Distributors',          'US',    '2.1',         'sftp', true,  'url', NULL),
('Baker & Taylor',               'US',    '2.1',         'sftp', true,  'url', NULL),
('Bookazine',                    'US',    '2.1',         'sftp', true,  'url', NULL),
('Brodart Library Suppliers',    'US',    '2.1',         'sftp', true,  'url', NULL),
('Chapters-Indigo Books & Music','CA',    '2.1',         'sftp', true,  'url', NULL),
('Christian Book Distribution',  'US',    '2.1',         'sftp', true,  'url', NULL),
('Mackin Educational Resources', 'US',    '2.1',         'sftp', true,  'url', NULL),
('MBS Textbook Exchange Inc.',   'US',    '2.1',         'sftp', true,  'url', NULL),
('Midwest Library Service',      'US',    '2.1',         'sftp', true,  'url', NULL),
('Noble Reps',                   'US',    '2.1',         'sftp', true,  'url', NULL),
('Powells',                      'US',    '2.1',         'sftp', true,  'url', NULL),
('The Book Company',             'US',    '2.1',         'sftp', true,  'url', NULL),
('The Booksource',               'US',    '2.1',         'sftp', true,  'url', NULL),
('United Library Services',      'CA',    '2.1',         'sftp', true,  'url', NULL),
-- ONIX 3.0
('Amazon US',                    'US',    '3.0',         'sftp', true,  'url', NULL),
('Amazon CA',                    'CA',    '3.0',         'sftp', true,  'url', 'Same format as Amazon US, separate SFTP credentials'),
('Barnes & Noble',               'US',    '3.0',         'sftp', true,  'url', NULL),
('Bowker',                       'US/UK', '3.0',         'sftp', true,  'url', NULL),
('Chegg',                        'US',    '3.0',         'sftp', true,  'url', NULL),
('eCampus',                      'US',    '3.0',         'sftp', true,  'url', NULL),
('Gazelle Book Services BSX',    'UK',    '3.0',         'sftp', true,  'url', NULL),
('Ingram Books',                 'US',    '3.0',         'sftp', true,  'url', NULL),
('Library of Congress',          'US',    '3.0',         'sftp', true,  'url', NULL),
('TBM BookManager / Mosaic Books','CA',   '3.0',         'sftp', true,  'url', NULL),
-- ONIX 3.1
('Edelweiss Marketing',                  'US', '3.1',    'sftp', true,  'url', NULL),
('Waterstones - Blackwells - Wordery',   'UK', '3.1',    'sftp', true,  'url', NULL),
-- Spreadsheet
('Educators Resource',           'US',    'spreadsheet', 'sftp', true,  'url', 'Custom spreadsheet format, not ONIX'),
-- Placeholders (delivery method unconfirmed)
('Channel Placeholder 1',        NULL,    NULL,          NULL,   false, 'url', 'Unconfirmed channel — update when delivery specs received'),
('Channel Placeholder 2',        NULL,    NULL,          NULL,   false, 'url', 'Unconfirmed channel — update when delivery specs received'),
('Channel Placeholder 3',        NULL,    NULL,          NULL,   false, 'url', 'Unconfirmed channel — update when delivery specs received');
