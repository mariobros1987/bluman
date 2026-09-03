import React, { type HTMLAttributes } from 'react';
import clsx from 'clsx';
import './Badge.css';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'success' | 'warning' | 'error' | 'info' | 'default';
}

export const Badge: React.FC<BadgeProps> = ({ 
  children, 
  className, 
  variant = 'default',
  ...props 
}) => {
  return (
    <span className={clsx('badge', `badge-${variant}`, className)} {...props}>
      {children}
    </span>
  );
};
