import { Alert, Button, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../app';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

function HomeScreen({ navigation }: Props) {
  return (
    <View style={styles.container}>
      <Button title="Hello world" onPress={() => Alert.alert('Hello World')} />
      <Button
        title="Go to Details"
        onPress={() => navigation.navigate('Details')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default HomeScreen;
