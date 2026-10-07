import { useState } from 'react';
import { Button, FlatList, StyleSheet, Text, View } from 'react-native';

function DetailsScreen() {
  const DATA = [
    { id: '1', name: 'string1' },
    { id: '2', name: 'string2' },
    { id: '3', name: 'string3' },
    { id: '4', name: 'string4' },
    { id: '5', name: 'string5' },
    { id: '6', name: 'string6' },
    { id: '7', name: 'string7' },
    { id: '8', name: 'string8' },
    { id: '9', name: 'string9' },
    { id: '10', name: 'string10' },
  ];
  const [flatArray, setFlatArray] = useState(DATA);

  const handleAddItem = () => {
    let oldArray = flatArray;

    setFlatArray([
      ...oldArray,
      { id: Date.now().toString(), name: 'string11' },
    ]);
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={flatArray}
        keyExtractor={item => item.id}
        renderItem={({ item }) => <Text>{item?.name}</Text>}
      />
      <Button title="Add item" onPress={handleAddItem} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default DetailsScreen;
