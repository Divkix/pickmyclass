'use client';

import { Eye, Mail, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { RecentActivityItem } from '@/lib/db/admin-queries';

interface RecentActivityProps {
  items: RecentActivityItem[];
}

const iconByType = {
  user_registration: Users,
  new_watch: Eye,
  email_sent: Mail,
} as const;

function formatNotificationType(notificationType: RecentActivityItem['notificationType']): string {
  if (!notificationType) return '';
  return notificationType === 'seat_available' ? 'seat available' : 'instructor assigned';
}

export function RecentActivity({ items }: RecentActivityProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent Activity</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recent activity to display</p>
        ) : (
          <ul className="space-y-3">
            {items.map((item) => {
              const Icon = iconByType[item.type];
              return (
                <li
                  key={`${item.type}-${item.userEmail}-${item.activityAt}`}
                  className="flex items-start gap-3"
                >
                  <div className="flex size-8 items-center justify-center rounded-full bg-muted shrink-0 mt-0.5">
                    <Icon className="size-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">
                      <span className="font-medium">{item.userEmail}</span>
                      {item.type === 'user_registration' && ' registered'}
                      {item.type === 'new_watch' && item.subject && item.catalogNbr && (
                        <>
                          {' '}
                          started watching{' '}
                          <span className="font-medium">
                            {item.subject} {item.catalogNbr}
                          </span>
                          {item.classNbr && ` (section ${item.classNbr})`}
                        </>
                      )}
                      {item.type === 'email_sent' && item.notificationType && (
                        <>
                          {' '}
                          notified about{' '}
                          <span className="font-medium">
                            {formatNotificationType(item.notificationType)}
                          </span>
                          {item.classNbr && ` for section ${item.classNbr}`}
                        </>
                      )}
                    </p>
                    <time
                      className="text-xs text-muted-foreground block mt-0.5"
                      dateTime={item.activityAt}
                      title={new Date(item.activityAt).toUTCString()}
                    >
                      {new Date(item.activityAt).toLocaleString()}
                    </time>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
