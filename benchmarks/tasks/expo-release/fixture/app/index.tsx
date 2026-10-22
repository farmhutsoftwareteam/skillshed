import { useEffect, useState } from "react";
import { FlatList, Text, View } from "react-native";

type Task = { id: string; title: string; done: boolean };

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    fetch("https://api.tidy.app/v1/tasks")
      .then((r) => r.json())
      .then(setTasks)
      .catch(() => setTasks([]));
  }, []);

  return (
    <View style={{ flex: 1, padding: 24 }}>
      <FlatList
        data={tasks}
        keyExtractor={(t) => t.id}
        renderItem={({ item }) => <Text>{item.done ? "✓ " : "○ "}{item.title}</Text>}
      />
    </View>
  );
}
