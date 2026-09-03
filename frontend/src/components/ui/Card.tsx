import React, { type HTMLAttributes } from 'react';
import clsx from 'clsx';
import './Card.css';

interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: React.ReactNode;
  footer?: React.ReactNode;
  noPadding?: boolean;
}

export const Card: React.FC<CardProps> = ({ 
  children, 
  className, 
  title, 
  footer,
  noPadding,
  ...props 
}) => {
  return (
    <div className={clsx('card', className)} {...props}>
      {title && <div className="card-header">{title}</div>}
      <div className={clsx('card-body', noPadding && 'p-0')}>{children}</div>
      {footer && <div className="card-footer">{footer}</div>}
    </div>
  );
};
