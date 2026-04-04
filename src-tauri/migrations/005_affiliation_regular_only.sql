-- Affiliation applies only to employee_type 'regular'.
UPDATE employees SET affiliation = NULL WHERE employee_type != 'regular';
