CREATE TABLE programmes (
  programme_id VARCHAR(64) PRIMARY KEY,
  programme_name VARCHAR(255) NOT NULL,
  programme_type VARCHAR(32) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE inventory_items (
  inventory_id VARCHAR(64) PRIMARY KEY,
  component_name VARCHAR(255) NOT NULL,
  quantity INT NOT NULL DEFAULT 0,
  location VARCHAR(255) NOT NULL DEFAULT 'Centre',
  replacement_cost DECIMAL(10, 2),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE borrowing_logs (
  borrowing_id VARCHAR(64) PRIMARY KEY,
  borrower_id VARCHAR(64) NOT NULL,
  item_id VARCHAR(64) NOT NULL,
  borrow_date DATE NOT NULL,
  return_date DATE,
  status VARCHAR(32) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_borrowing_item FOREIGN KEY (item_id) REFERENCES inventory_items(inventory_id)
);
