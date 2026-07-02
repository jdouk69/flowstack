import { Card, CardContent } from '@/components/ui/card';

export default function StatCard({ icon: Icon, label, value }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
          </div>
          <div className="p-2.5 rounded-xl bg-muted text-primary">
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}